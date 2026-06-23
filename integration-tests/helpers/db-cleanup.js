async function truncateTestData(dbClient) {
  // bng.relationships / bng.roles cascade from bng.users, but list them
  // explicitly so the intent is clear and order-independent. RESTART IDENTITY
  // CASCADE also clears baseline/post-intervention feature rows that FK to
  // bng.projects.
  await dbClient.query(
    'TRUNCATE bng.audit_log, bng.projects, bng.users, bng.relationships, bng.roles RESTART IDENTITY CASCADE'
  )
}

export { truncateTestData }
