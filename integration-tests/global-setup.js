import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import pg from 'pg'
import { getDbConfig } from './helpers/db.js'

const execFileAsync = promisify(execFile)
const { Client } = pg

async function probePostgres() {
  const cfg = getDbConfig()
  const client = new Client({ ...cfg, connectionTimeoutMillis: 3000 })
  try {
    await client.connect()
    await client.query('SELECT 1')
  } finally {
    await client.end().catch(() => {})
  }
}

async function applyMigrations() {
  const { stdout, stderr } = await execFileAsync('npm', ['run', 'db:update'], {
    maxBuffer: 32 * 1024 * 1024
  })
  if (process.env.DEBUG_INTEGRATION) {
    process.stdout.write(stdout)
    process.stderr.write(stderr)
  }
}

export async function setup() {
  const cfg = getDbConfig()
  try {
    await probePostgres()
  } catch (error) {
    throw new Error(
      `Postgres not reachable at ${cfg.host}:${cfg.port}/${cfg.database}: ${error.message}\n` +
        'Run `docker compose up -d` from this repo before running integration tests.'
    )
  }

  if (process.env.SKIP_MIGRATIONS === '1') {
    return
  }

  try {
    await applyMigrations()
  } catch (error) {
    throw new Error(
      `Liquibase migrations failed: ${error.message}\n` +
        'Ensure Docker is running and the cdp-tenant network exists (compose up).\n' +
        'In CI, set SKIP_MIGRATIONS=1 and apply migrations as a separate workflow step.'
    )
  }
}
