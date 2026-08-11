# Project data audit logging

## Purpose

BMD-788 requires every successful change to auditable project data to record
the actor, timestamp and change made. The authoritative record is the
immutable database audit history in `bng.audit_log`. PostgreSQL writes a full
after-change project snapshot for every `INSERT` or `UPDATE` of `bng.projects`.

Operational Pino/CDP logs, metrics and traces are observability data; they are
not the project-data audit record.

## Recorded fields

| Field                 | Meaning                                                                |
| --------------------- | ---------------------------------------------------------------------- |
| `project_id`          | Project changed                                                        |
| `project`             | Complete after-change JSON snapshot showing the resulting values       |
| `previous_project`    | Pre-change snapshot (`NULL` for creation and pre-migration history)    |
| `user_id`             | Verified Defra ID token subject of the actor that performed the change |
| `operation`           | Database operation (`INSERT` or `UPDATE`)                              |
| `audited_at`          | Database-generated timestamp with time zone                            |
| `bng_project_version` | BNG document schema version                                            |

`projects.user_id` remains the project owner. `projects.last_modified_by` is set on every sanctioned write from the verified token and is the source of `audit_log.user_id`. Keeping these fields separate prevents owner identity being mistaken for actor identity.

The database also supplies `user_id` as the actor when an instance of the
application version immediately preceding BMD-788 omits `last_modified_by`
during a rolling deployment. That version only permits project owners to
write their own projects, so its owner and authenticated actor are the same.
Current application writes must always provide the explicit actor; persistence
validation and the project-write boundary regression test enforce that
contract.

Audit history is append-only. Database guard triggers reject `UPDATE`, `DELETE` and `TRUNCATE` of `bng.audit_log`.

The application does not currently emit project-change events to the CDP audit
stream. Integration with the GIO data platform requires separate design and
delivery work and is intentionally outside BMD-788.

## Auditable data coverage

| Auditable data type       | Application change                                                | Before/after snapshot | Actor and timestamp | Integration evidence                                                                                  |
| ------------------------- | ----------------------------------------------------------------- | --------------------- | ------------------- | ----------------------------------------------------------------------------------------------------- |
| Project                   | Create project                                                    | Yes                   | Yes                 | [`audit-log.test.js`](../integration-tests/audit-log.test.js)                                         |
| Project name              | Rename project                                                    | Yes                   | Yes                 | [`audit-log.test.js`](../integration-tests/audit-log.test.js)                                         |
| Project details           | Update project metadata/details                                   | Yes                   | Yes                 | [`project-details.test.js`](../integration-tests/project-details.test.js)                             |
| Baseline upload           | Replace baseline document and derived totals                      | Yes                   | Yes                 | [`baseline-persistence.test.js`](../integration-tests/baseline-persistence.test.js)                   |
| Post-intervention upload  | Replace post-intervention document and derived totals             | Yes                   | Yes                 | [`post-intervention-persistence.test.js`](../integration-tests/post-intervention-persistence.test.js) |
| Baseline feature          | Edit an area, hedgerow or watercourse and recalculate totals      | Yes                   | Yes                 | [`features.test.js`](../integration-tests/features.test.js)                                           |
| Post-intervention feature | Edit a supported post-intervention habitat and recalculate totals | Yes                   | Yes                 | [`post-intervention-persistence.test.js`](../integration-tests/post-intervention-persistence.test.js) |

The generated [data dictionary](../data-dictionary/data-dictionary.md) defines every field contained in the project JSON snapshot.

## Spatial geometry scope

Uploaded geometries are stored in normalized PostGIS tables in the same transaction as the corresponding baseline or post-intervention project-document update. The upload action, actor, source `uploadId`, and resulting non-spatial project data are audited. The source `uploadId` provides traceability to the uploaded artefact under the platform retention controls; raw geometry values are not duplicated into `bng.audit_log`. Copying full geometries into each audit entry would substantially increase audit volume.

If raw geometry history is required as auditable data, introduce a separate versioned spatial-history design.

## Delete and service-change scope

There is currently no project deletion endpoint. A database trigger rejects `DELETE` from `bng.projects`, preventing an unaudited deletion from being introduced accidentally. A future deletion workflow must first add an immutable record containing the actor and deleted state.

All current project writes originate from an authenticated request. A future scheduled job, administrator or service-to-service mutation must supply an explicit service actor identity through the same persistence API.

## Evidence

- Trigger creation: `changelog/db.changelog-1.4.xml`
- Atomic actor/before-state migration and rolling-deployment fallback:
  `changelog/db.changelog-1.11.xml`
- Append-only controls: `changelog/db.changelog-1.9.xml`
- Sanctioned persistence API: `src/db/persist-project.js`
- Core actor/timestamp/change and previous-version compatibility evidence:
  `integration-tests/audit-log.test.js`
- Immutability integration evidence: `integration-tests/audit-log-immutability.test.js`
- Field coverage: `integration-tests/data-dictionary-coverage.test.js`
- Per-data-type route evidence: linked from the coverage table above

Run the core database evidence with:

```sh
npm run test:integration -- integration-tests/audit-log.test.js integration-tests/audit-log-immutability.test.js
```
