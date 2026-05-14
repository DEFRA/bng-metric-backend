import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { getDbConfig } from './helpers/db.js'

const execFileAsync = promisify(execFile)
const { Client } = pg

const ROUTE_HITS_FILE = path.resolve('coverage/route-hits.json')

function resetRouteHits() {
  fs.mkdirSync(path.dirname(ROUTE_HITS_FILE), { recursive: true })
  fs.writeFileSync(ROUTE_HITS_FILE, '[]\n')
}

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
  // On Windows the npm script runs a .sh via Docker — use wsl to invoke it.
  const isWin = process.platform === 'win32'
  const cmd = isWin ? 'wsl' : 'npm'
  const args = isWin ? ['npm', 'run', 'db:update'] : ['run', 'db:update']
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    maxBuffer: 32 * 1024 * 1024
  })
  if (process.env.DEBUG_INTEGRATION) {
    process.stdout.write(stdout)
    process.stderr.write(stderr)
  }
}

export async function setup() {
  // Wipe any prior run's route hits before workers start collecting fresh ones.
  // Workers run with isolate:true so each test file gets a fresh module graph;
  // the recorder merges with the on-disk file rather than holding state across
  // files, which only works if we start from a known-empty file.
  resetRouteHits()

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
