# Downstream failures

How the backend behaves when Postgres, S3 or CDP Uploader fails, and the tests
that show it. Written for BMD-1174, after the CDP production readiness review
asked for evidence that the service handles the failure of the services it
depends on.

The rule throughout: a failure returns an HTTP error promptly, never hangs the
request, never takes the process down, and never puts the downstream error
text in the response body. The detail goes to the log.

## Postgres

| Failure                                          | What happens                                                                                                                                           | Tests                                                                                                          |
| :----------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------- |
| Database unreachable at start-up                 | The plugin runs `SELECT 1` while registering and throws, so the task fails to start and ECS replaces it, rather than serving requests it cannot answer | `src/plugins/postgres.test.js` › "Should throw if startup connection fails"                                    |
| IAM authentication token cannot be obtained      | Logged and rethrown, so the connection attempt fails                                                                                                   | `src/plugins/postgres.test.js` › "Should log and rethrow when IAM token request fails"                         |
| IAM authentication on without the TLS context    | The service refuses to start, instead of connecting without the platform CA                                                                            | `src/plugins/postgres.test.js` › "Should fail at boot when IAM is on but no secureContext is registered"       |
| An idle connection breaks                        | The pool logs the error and opens a new connection for the next query; the process stays up                                                            | `src/plugins/postgres.test.js` › "Should log pool errors"                                                      |
| Database unreachable during a request            | The request gets a plain 500 that does not reveal the database error                                                                                   | `src/routes/database-unavailable.test.js`                                                                      |
| Project row locked by another write              | 409, after `lock_timeout`, rather than waiting indefinitely                                                                                            | `src/routes/baseline.persistence-errors.test.js` › "lock contention and rollback"                              |
| A write fails part-way through a baseline upload | The transaction rolls back: the project document is not written                                                                                        | `src/routes/baseline.persistence-errors.test.js` › "does not write the project document when an insert throws" |

`/health` does not query the database. It reports that the process is alive, so
a database outage does not make ECS replace healthy tasks in a loop; the pool
reconnects when the database comes back.

## S3 (uploaded files)

| Failure                                      | What happens                                 | Tests                                                                                                                                             |
| :------------------------------------------- | :------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ |
| Download times out                           | 504                                          | `src/services/s3/download-file.test.js` › "throws S3TimeoutError…"; `src/routes/baseline.persistence-errors.test.js` › "S3TimeoutError"           |
| S3 unreachable, or the stream fails part-way | 502; the partly written temp file is removed | `src/services/s3/download-file.test.js` › "connection error"; `src/routes/baseline.persistence-errors.test.js` › "S3ConnectionError"              |
| Object larger than the limit                 | 413, before a temp file is created           | `src/services/s3/download-file.test.js` › "exceeds MAX_FILE_SIZE_BYTES"; `src/routes/baseline.persistence-errors.test.js` › "S3FileTooLargeError" |
| Any other download error                     | 502                                          | `src/routes/baseline.persistence-errors.test.js` › "downloadFileToTemp throws an unexpected error"                                                |

## CDP Uploader

| Failure                                  | What happens                    | Tests                                                                                                                                               |
| :--------------------------------------- | :------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| File not ready in time                   | 504; the file is not downloaded | `src/routes/baseline.persistence-errors.test.js` › "UploadTimeoutError"                                                                             |
| Upload failed or rejected                | 422                             | `src/routes/baseline.persistence-errors.test.js` › "UploadFailedError"                                                                              |
| Uploader unreachable or returns an error | 502                             | `src/routes/baseline.persistence-errors.test.js` › "waitForUploadReady throws an unexpected error"; `src/routes/upload.test.js` › "Boom badGateway" |

## Not covered by automated tests

These tests replace each downstream service with a stand-in that fails. No
test stops a real Postgres or S3 while the service runs. That check belongs in
a deployed environment, as an operational test.
