import fs from 'node:fs'
import path from 'node:path'

const HITS_FILE = path.resolve('coverage/route-hits.json')

// Vitest workers run with isolate:true by default, so each test file gets a
// fresh module graph — meaning a Set in this module would reset between files
// and a worker-end flush would only see one file's hits. So we merge with the
// on-disk file on every newly-seen route. The file is initialised to `[]` by
// global-setup.js once per run, so stale hits from prior runs don't leak in.
const routeRecorder = {
  name: 'route-recorder',
  register(server) {
    server.ext('onPreResponse', (request, h) => {
      const route = request.route
      if (route?.path && route.path !== '/{p*}') {
        recordHit(`${route.method.toUpperCase()} ${route.path}`)
      }
      return h.continue
    })
  }
}

function recordHit(key) {
  const existing = readExisting()
  if (existing.has(key)) {
    return
  }
  existing.add(key)
  fs.mkdirSync(path.dirname(HITS_FILE), { recursive: true })
  fs.writeFileSync(
    HITS_FILE,
    JSON.stringify(
      [...existing].sort((a, b) => a.localeCompare(b)),
      null,
      2
    )
  )
}

function readExisting() {
  try {
    return new Set(JSON.parse(fs.readFileSync(HITS_FILE, 'utf8')))
  } catch {
    return new Set()
  }
}

export { routeRecorder }
