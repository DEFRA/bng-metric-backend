// bng.audit_log is append-only in every environment: guard triggers added in
// changelog/db.changelog-1.9.xml reject UPDATE, DELETE and TRUNCATE against it.
// Integration tests run against a throwaway database and must still reset it
// between files, so the cleanup momentarily switches the session into the
// `replica` replication role — which suspends origin triggers (the guards
// included) for this connection only. The local/CI Postgres runs as a superuser,
// which this SET requires; production application connections never have that
// privilege, so they can never bypass the guard this way.
const BYPASS_GUARD = "SET session_replication_role = 'replica'"
const RESTORE_GUARD = "SET session_replication_role = 'origin'"

async function truncateTestData(dbClient) {
  await dbClient.query(BYPASS_GUARD)
  try {
    // bng.relationships / bng.roles cascade from bng.users, but list them
    // explicitly so the intent is clear and order-independent. RESTART IDENTITY
    // CASCADE also clears baseline/post-intervention feature rows that FK to
    // bng.projects.
    await dbClient.query(
      'TRUNCATE bng.audit_log, bng.projects, bng.users, bng.relationships, bng.roles RESTART IDENTITY CASCADE'
    )
  } finally {
    await dbClient.query(RESTORE_GUARD)
  }
}

export { truncateTestData }
