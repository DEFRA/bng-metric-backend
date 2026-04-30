import pg from 'pg'

const { Client } = pg

const DEFAULT_POSTGRES_PORT = 5432

function getDbConfig() {
  return {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? DEFAULT_POSTGRES_PORT),
    user: process.env.DB_USER ?? 'dev',
    password: process.env.DB_LOCAL_PASSWORD ?? 'dev',
    database: process.env.DB_DATABASE ?? 'bng_metric_backend'
  }
}

async function connect() {
  const client = new Client(getDbConfig())
  await client.connect()
  return client
}

export { connect, getDbConfig }
