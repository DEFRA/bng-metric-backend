#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createServer } from '../src/server.js'

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)
const manifestPath = path.join(
  projectRoot,
  'integration-tests/route-manifest.json'
)
const hitsPath = path.join(projectRoot, 'coverage/route-hits.json')

if (!fs.existsSync(hitsPath)) {
  console.error(
    `Route hits file not found at ${hitsPath}.\n` +
      'Run `npm run test:integration:coverage` first so the route recorder writes hits.'
  )
  process.exit(1)
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const hits = JSON.parse(fs.readFileSync(hitsPath, 'utf8'))

const server = await createServer()
const registered = server
  .table()
  .map((r) => `${r.method.toUpperCase()} ${r.path}`)
  .filter((r) => !r.endsWith('/{p*}'))
  .sort()
await server.stop()

const manifestSet = new Set(manifest)
const registeredSet = new Set(registered)
const hitsSet = new Set(hits)

const missingFromManifest = registered.filter((r) => !manifestSet.has(r))
const extraInManifest = manifest.filter((r) => !registeredSet.has(r))
const uncovered = manifest.filter((r) => !hitsSet.has(r))

const errors = []
if (missingFromManifest.length) {
  errors.push(
    `Routes registered but not in route-manifest.json: ${missingFromManifest.join(', ')}`
  )
}
if (extraInManifest.length) {
  errors.push(
    `Manifest entries not actually registered: ${extraInManifest.join(', ')}`
  )
}
if (uncovered.length) {
  errors.push(
    `Routes not exercised by any integration test: ${uncovered.join(', ')}`
  )
}

if (errors.length) {
  console.error('Route coverage check failed:')
  for (const err of errors) {
    console.error('  - ' + err)
  }
  process.exit(1)
}

console.log(`Route coverage OK — ${manifest.length} routes, all exercised.`)
