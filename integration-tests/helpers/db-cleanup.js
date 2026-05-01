async function truncateTestData(dbClient) {
  await dbClient.query(
    'TRUNCATE bng.audit_log, bng.projects RESTART IDENTITY CASCADE'
  )
}

export { truncateTestData }
