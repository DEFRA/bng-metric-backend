# Data Dictionary

The **data dictionary** documents every field saved to the database: the Postgres
columns (straightforward) and — the harder part — the `project` JSONB blob stored
on `bng.projects.project` (and snapshotted into `bng.audit_log.project`).

It is **generated**, never hand-written, from the two declarative sources of
truth the backend already maintains:

| Source of truth                       | Drives                                                                                                       | Lives in                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| Drizzle table definitions             | the Postgres column tables                                                                                   | `src/db/schema/*.js`             |
| `TABLE_DESCRIPTIONS` in the generator | the plain-language sentence under each Postgres table                                                        | `scripts/gen-data-dictionary.js` |
| The Joi schema for the `project` blob | the JSON field tables (path, type, constraints, **description** in Markdown; plus required/nullable in JSON) | `src/validation/project.js`      |

The Markdown is also tailored for non-technical readers: the `Req?`/`Null?`
columns are dropped (they remain in the JSON), every type and foreign-key target
is code-formatted, and source-file references are absolute links into the
[GitHub repo](https://github.com/DEFRA/bng-metric-backend) so they resolve when
the page is mirrored to Confluence.

The output is committed to the repo so it is reviewable in PRs:

- [`data-dictionary/data-dictionary.md`](../data-dictionary/data-dictionary.md) — human-readable
- [`data-dictionary/data-dictionary.json`](../data-dictionary/data-dictionary.json) — machine-readable

> Related: [SCHEMA_REFLECTION.md](SCHEMA_REFLECTION.md) explains how the Drizzle
> and Joi files themselves are kept in sync with the live `bng` schema. The data
> dictionary is the documentation generated _from_ those files.

## Generating the dictionary

```sh
npm run data-dictionary
```

This runs `scripts/gen-data-dictionary.js` and then Prettier-formats the two
output files. It needs **no database connection** — it introspects the Drizzle
table objects in-process and walks `projectSchema.describe()`. It reads no clock
and no randomness, so the output is **deterministic**: the same schema always
produces byte-identical files. That property is what makes the CI check below
reliable rather than flaky.

The field descriptions come from the `.description()` annotation on each key in
`src/validation/project.js`. To improve the prose in the dictionary, edit those
annotations (they also surface in the Swagger UI) and regenerate — do **not**
edit `data-dictionary/data-dictionary.*` by hand.

## The two consistency guards

The dictionary is only useful if it stays true. Two independent guards enforce
that, catching two different kinds of drift:

| Guard                                                                                                                                                 | Runs in                                 | Fails when…                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------- |
| **Coverage tests** — `src/validation/project-coverage.test.js` (in-process) and `integration-tests/data-dictionary-coverage.test.js` (real read-back) | `npm test` / `npm run test:integration` | the **code persists a field the schema does not declare** |
| **Freshness check** — regenerate + `git diff`                                                                                                         | the `pr-validator` CI job               | the **committed docs do not match the schema**            |

The coverage tests drive the real construction code (`extractBaseline` +
enrichment, the `recompute*` edit functions, and the live HTTP upload/edit paths)
and assert that every persisted key is declared in the Joi schema. They protect
against the schema silently falling behind the code — which matters because the
persist paths use `{ allowUnknown: true }` (baseline) or no Joi validation at all
(the feature-edit PUT), so nothing at runtime would otherwise stop an undocumented
field from being saved.

## How the CI freshness check works

In `.github/workflows/check-pull-request.yml`, the `pr-validator` job runs:

```yaml
- name: Data dictionary is up to date
  run: |
    npm run data-dictionary
    git diff --exit-code -- data-dictionary/data-dictionary.md data-dictionary/data-dictionary.json
```

The mechanism is easy to misread, so to be explicit: **`git diff` is not comparing
the `.md` to the `.json`.** It compares each freshly regenerated file against the
**committed** version of that same file in the PR:

1. The runner checks out the PR. `data-dictionary/data-dictionary.{md,json}` are whatever the
   author committed.
2. `npm run data-dictionary` overwrites those two files in the working tree with
   output derived purely from the **committed** `src/validation/project.js` and
   `src/db/schema/*`.
3. `git diff --exit-code` exits `0` if the regenerated files are identical to the
   committed ones, or `1` (failing the step) if they differ.

Because generation is deterministic and reads only the schema, the regenerated
output equals the committed docs **unless the committed docs are stale relative to
the committed schema**. So the check answers a single question: _"are the
committed docs the up-to-date product of the committed schema?"_

The check runs after `npm test` in the same job, so the ordering of failures is:

```
npm ci
npm run format:check
npm run lint
npm test                       ← coverage guard fails here if code drifts from schema
[Data dictionary is up to date] ← freshness diff fails here if docs drift from schema
[Security audit]
```

## Developer workflow

### Success — changing a field

You add a new field to a habitat (and the code that persists it):

1. Add the field to the relevant schema in `src/validation/project.js`, **with a
   `.description()`**.
2. `npm test` — the coverage guard confirms the schema now covers the new
   persisted field (and tells you the exact path if you missed one).
3. `npm run data-dictionary` — regenerate `data-dictionary/data-dictionary.{md,json}`.
4. Commit the schema change **and** the regenerated docs together.
5. CI regenerates from your committed schema, gets byte-identical files, `git diff`
   exits `0` → ✅ green.

### Failure — forgot to regenerate

You changed the schema and committed, but skipped step 3:

1. CI runs `npm run data-dictionary`, which regenerates the docs from your new
   schema. They no longer match the stale docs you committed.
2. `git diff --exit-code` prints the unified diff and exits `1` → ❌ the step fails:

   ```diff
   diff --git a/data-dictionary/data-dictionary.md b/data-dictionary/data-dictionary.md
   @@
   +| `baseline.habitats[].retentionScore` | `number` | — | Retention score… |
   ```

   The diff in the CI log shows exactly which lines are out of date.

3. Fix locally: `npm run data-dictionary`, commit the docs, push. CI goes green.

### Failure — persisted a field but didn't document it

You added code that writes a new field but didn't add it to the Joi schema:

1. `npm test` fails first, in the coverage guard, naming the undeclared path —
   e.g. `recomputeAreaHabitat field "retentionScore" is not declared in the
schema`, or `"baseline.habitats[].retentionScore" is not allowed`.
2. Add the field (with a `.description()`) to `src/validation/project.js`, then
   follow the success workflow above.

## Publishing to Confluence

On every merge to `main`, the **Publish Data Dictionary** workflow
(`.github/workflows/publish-data-dictionary.yml`) mirrors
`data-dictionary/data-dictionary.md` to a Confluence page so non-technical staff
can read it without GitHub access. The workflow's `paths` filter means it runs
**only when the Markdown actually changed** in the merge — an unchanged
dictionary never republishes.

`scripts/publish-confluence.mjs` reads the committed Markdown, converts it to
Confluence storage format via `scripts/markdown-to-confluence.mjs`, and updates
the target page **by ID**: it GETs the current version then PUTs the new body
with the version incremented. The conversion is dependency-free (Node built-ins
only) and covered by `scripts/markdown-to-confluence.test.js`.

To preview the exact storage XHTML that would be pushed, without contacting
Confluence:

```sh
node scripts/publish-confluence.mjs --dry-run
```

The workflow reads its target and credentials from repository settings — set
these once under **Settings → Secrets and variables → Actions**:

| Setting                              | Kind     | Example / meaning                             |
| ------------------------------------ | -------- | --------------------------------------------- |
| `CONFLUENCE_BASE_URL`                | Variable | `https://defra.atlassian.net/wiki`            |
| `CONFLUENCE_DATA_DICTIONARY_PAGE_ID` | Variable | Numeric ID of the existing page to update     |
| `CONFLUENCE_USER_EMAIL`              | Secret   | Atlassian account email (Basic-auth username) |
| `CONFLUENCE_API_TOKEN`               | Secret   | Atlassian API token (Basic-auth password)     |

Create the page in Confluence once, take its page ID from the URL, and generate
an API token at <https://id.atlassian.com/manage-profile/security/api-tokens>.

## Quick reference

| Command                                                                                           | Purpose                                                  |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `npm run data-dictionary`                                                                         | Regenerate `data-dictionary/data-dictionary.{md,json}`   |
| `npm test`                                                                                        | Run the in-process coverage guard (among all unit tests) |
| `npm run test:integration`                                                                        | Run the read-back guard against a real Postgres          |
| `git diff --exit-code -- data-dictionary/data-dictionary.md data-dictionary/data-dictionary.json` | Reproduce the CI freshness check locally                 |

## Files

```
bng-metric-backend/
  .github/workflows/
    publish-data-dictionary.yml                  # merge-to-main → Confluence publish
  scripts/
    gen-data-dictionary.js                       # generator (Drizzle + Joi → docs)
    markdown-to-confluence.mjs                   # Markdown → Confluence storage format
    markdown-to-confluence.test.js               # converter unit tests
    publish-confluence.mjs                       # updates the Confluence page by ID
  src/
    validation/
      project.js                                 # Joi schema — source of fields + descriptions
      data-dictionary-paths.js                   # shared schema/data path helpers
      project-coverage.test.js                   # in-process coverage guard
  integration-tests/
    data-dictionary-coverage.test.js             # real read-back coverage guard
  data-dictionary/
    data-dictionary.md                           # generated — do not edit by hand
    data-dictionary.json                         # generated — do not edit by hand
  docs/
    DATA_DICTIONARY.md                           # this document
```
