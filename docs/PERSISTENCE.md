# Persisting project data

Everything written to the `bng.projects.project` JSONB column goes through one
module: [`src/db/persist-project.js`](../src/db/persist-project.js). It is the
single, validated **choke point** for project writes.

## Why a choke point

The persisted document is the source the [data dictionary](DATA_DICTIONARY.md)
is generated from, and the runtime persist paths are otherwise lenient — the
baseline route validates with `{ allowUnknown: true }` and the feature-edit
routes do no Joi validation at all. Nothing else stops a route from writing a
field the schema (and therefore the dictionary) doesn't declare.

So every write here **validates the fragment it touches against the matching
slice of the Joi schema before it reaches the database**. A failure means the
server assembled an invalid document — a bug — so it surfaces as a 500 rather
than silently persisting. (Bad _client_ input is rejected earlier, with a 400,
by the route's Hapi `validate` block.)

## Partial writes

We never re-serialise the whole document on a small change — a single habitat
edit must not rewrite a baseline that can hold ~1000 parcels. Each helper writes
only its subtree with `jsonb_set`, and validates only that subtree:

| Helper                  | Actor-aware call shape                                                                       | Writes (path)                             | Validates against                                        |
| ----------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------- |
| `insertProject`         | `insertProject(db, { project, userId, orgId?, relationshipId? })`                            | whole row (INSERT)                        | `projectSchema`                                          |
| `setProjectName`        | `setProjectName(exec, id, name, actorId, where?)`                                            | `{name}`                                  | `projectSchema.extract('name')`                          |
| `setProjectHabitatData` | `setProjectHabitatData(exec, id, habitatData, actorId, documentKey)`                         | `{postIntervention}`                      | post-intervention habitat document schema                |
| `setProjectBaseline`    | `setProjectBaseline(exec, id, baseline, actorId)`                                            | `{baseline}`                              | `baselineSchema`                                         |
| `setProjectFeature`     | `setProjectFeature(exec, id, { documentKey?, layer, index, feature, unitsTotals, actorId })` | one feature + document unit totals        | matching layer item schema + `baselineUnitsTotalsSchema` |
| `setBaselineFeature`    | `setBaselineFeature(exec, id, { layer, index, feature, unitsTotals, actorId })`              | one baseline feature + `{baseline,units}` | matching layer item schema + `baselineUnitsTotalsSchema` |
| `setProjectDetails`     | `setProjectDetails(exec, id, patch, actorId, where?)`                                        | `{details}` merge                         | `projectDetailsSchema`                                   |

`setProjectFeature` is the partial-update workhorse: the feature-edit routes
read the project under `SELECT … FOR UPDATE`, recompute one feature via
`applyFeatureUpdate`, and hand the result to the helper — two small `jsonb_set`
writes instead of the whole array.

## Audit actor

Every sanctioned write stamps `projects.last_modified_by`. Route and upload
callers must pass the verified Defra ID token `sub` as `actorId`; project
creation uses its verified `userId` for both ownership and the initial actor.
The database audit trigger copies `last_modified_by` to `audit_log.user_id` and
generates `audit_log.audited_at`.

`projects.user_id` remains the project owner and must not be reused as the actor
for later changes. This distinction ensures delegated or future multi-user
changes are attributed to the identity that performed the mutation.

For rolling-deployment compatibility, the database fills `last_modified_by`
from `user_id` only when the immediately preceding application version omits
the new column. That version authorizes only the project owner to write, making
the fallback identity equivalent to its authenticated actor. New application
code must not rely on this fallback: every persistence helper rejects a missing
or blank actor before issuing SQL.

## The guards

Three independent guards keep the column, the schema, and the docs in lockstep:

1. **No bypass (lint).** An ESLint `no-restricted-syntax` rule
   (`eslint.config.js`) bans direct `.insert(projects)` / `.update(projects)`
   anywhere except `persist-project.js`. A new route that writes the table
   directly fails `npm run lint` (a CI gate), so it _has_ to come through the
   validating helper.
2. **Schema covers reality (tests).** `src/validation/project-coverage.test.js`
   and `integration-tests/data-dictionary-coverage.test.js` drive the real
   construction/edit code and assert every persisted key is declared in the
   schema — catching the schema falling behind the code.
3. **Docs match the schema (CI).** The "Data dictionary is up to date" step
   regenerates the dictionary and fails the PR if it drifts. See
   [DATA_DICTIONARY.md](DATA_DICTIONARY.md).

The persistence unit tests verify each helper includes `lastModifiedBy` in its
write, and the audit-log integration tests verify actor, timestamp and snapshots.

## Adding a new write path

1. Add (or reuse) a helper in `persist-project.js` that validates the fragment
   against the relevant schema slice, then `jsonb_set`s only that path. Object
   subtrees can derive their schema with `projectSchema.extract('<path>')`;
   array-element writes pick the item schema explicitly (see the layer map).
2. Call it from your route with the verified actor identity. **Do not** call
   `.insert/.update(projects)` directly — the lint rule will reject it.
3. If you introduced a new field, add it to `src/validation/project.js` (with a
   `.description()`) and run `npm run data-dictionary`.
