import { afterEach, describe, expect, it } from 'vitest'
import Hapi from '@hapi/hapi'

import { getProjects, getProject, createProject } from './projects.js'

// What a caller gets back when Postgres cannot be reached mid-request: a plain
// 500, promptly, with nothing about the database in the body. The pool's own
// failure modes (startup connection, pool errors, IAM token) are covered in
// plugins/postgres.test.js; see docs/downstream-failures.md for the full map.

const PROJECT_ID = '3f1e45b4-2e81-4c70-8a70-083ad958c913'
const DB_ERROR_TEXT = 'connect ECONNREFUSED 10.0.0.1:5432'

// A drizzle stand-in whose every query chain rejects as an unreachable pool
// does, whichever builder methods the handler calls.
function unreachableDrizzle() {
  const error = Object.assign(new Error(DB_ERROR_TEXT), {
    code: 'ECONNREFUSED'
  })
  const chain = new Proxy(function () {}, {
    get: (_target, prop) =>
      prop === 'then' ? (_resolve, reject) => reject(error) : chain,
    apply: () => chain
  })
  return chain
}

describe('when the database is unreachable', () => {
  let server

  afterEach(async () => {
    await server?.stop()
  })

  async function serverWith(route) {
    server = Hapi.server()
    server.auth.scheme('test', () => ({
      authenticate: (_request, h) =>
        h.authenticated({ credentials: { sub: 'test-user-001' } })
    }))
    // Registered under the real strategy name, which the routes name.
    server.auth.strategy('defra-jwt', 'test')
    server.auth.default('defra-jwt')
    server.ext('onRequest', (request, h) => {
      request.drizzle = unreachableDrizzle()
      return h.continue
    })
    server.route(route)
    await server.initialize()
    return server
  }

  it.each([
    ['GET /projects', getProjects, { method: 'GET', url: '/projects' }],
    [
      'GET /projects/{id}',
      getProject,
      { method: 'GET', url: `/projects/${PROJECT_ID}` }
    ],
    [
      'POST /projects/new',
      createProject,
      {
        method: 'POST',
        url: '/projects/new',
        payload: { project: { name: 'Greenfield Meadow' } }
      }
    ]
  ])(
    '%s returns a 500 that does not reveal the database error',
    async (_name, route, request) => {
      await serverWith(route)

      const res = await server.inject(request)

      expect(res.statusCode).toBe(500)
      expect(res.payload).not.toContain('ECONNREFUSED')
      expect(res.payload).not.toContain('5432')
    }
  )
})
