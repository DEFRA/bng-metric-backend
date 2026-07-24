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
  let cmd, args

  if (process.platform === 'win32') {
    // On Windows, run the Docker Liquibase container directly rather than
    // going through a bash shell script (WSL bash may not be available).
    // Mount a pinned JDBC jar into /liquibase/lib instead of using LPM —
    // LPM package-manifest checksums periodically drift from Maven artifacts.
    const changelogDir = path.resolve('changelog').replaceAll('\\', '/')
    const postgresJdbcVersion = process.env.POSTGRES_JDBC_VERSION ?? '42.7.8'
    const driverCacheDir = path.resolve('.cache/liquibase')
    const driverJar = path.join(
      driverCacheDir,
      `postgresql-${postgresJdbcVersion}.jar`
    )
    const driverUrl = `https://repo1.maven.org/maven2/org/postgresql/postgresql/${postgresJdbcVersion}/postgresql-${postgresJdbcVersion}.jar`
    fs.mkdirSync(driverCacheDir, { recursive: true })
    if (!fs.existsSync(driverJar)) {
      const response = await fetch(driverUrl)
      if (!response.ok) {
        throw new Error(
          `Failed to download PostgreSQL JDBC driver: ${response.status} ${response.statusText}`
        )
      }
      fs.writeFileSync(driverJar, Buffer.from(await response.arrayBuffer()))
    }
    const driverJarMount = driverJar.replaceAll('\\', '/')
    cmd = 'docker'
    args = [
      'run',
      '--rm',
      '--network',
      'cdp-tenant',
      '--entrypoint',
      'sh',
      '-v',
      `${changelogDir}:/liquibase/changelog`,
      '-v',
      `${driverJarMount}:/liquibase/lib/postgresql-${postgresJdbcVersion}.jar:ro`,
      'liquibase/liquibase',
      '-c',
      'liquibase --changelog-file=changelog/db.changelog.xml --url=jdbc:postgresql://postgres:5432/bng_metric_backend --username=dev --password=dev update'
    ]
  } else {
    cmd = 'npm'
    args = ['run', 'db:update']
  }

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
