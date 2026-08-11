import { describe, test, expect, vi } from 'vitest'
import { asc, desc, sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { getUserProjects } from './users.js'
import { projects } from '../db/schema/index.js'

const TEST_USER_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
const UNKNOWN_USER_ID = '00000000-0000-0000-0000-000000000000'
const REL_CURRENT = 'rel-current-org'
const REL_OTHER = 'rel-other-org'

const mockUserProjects = [
  {
    id: 'aaa11111-0000-0000-0000-000000000001',
    project: {
      name: 'Greenfield Meadow Restoration',
      site: { name: 'Greenfield Meadow', grid_ref: 'TQ 123 456' },
      units: { habitat: 10.5, hedgerow: 2.3, watercourse: 0.8 }
    },
    userId: TEST_USER_ID,
    bngProjectVersion: 1,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02')
  },
  {
    id: 'bbb22222-0000-0000-0000-000000000002',
    project: {
      name: 'Oakwood Farm BNG Assessment',
      site: { name: 'Oakwood Farm', grid_ref: 'SP 987 654' },
      units: { habitat: 25, hedgerow: 8.1 }
    },
    userId: TEST_USER_ID,
    bngProjectVersion: 1,
    createdAt: new Date('2024-02-01'),
    updatedAt: new Date('2024-02-02')
  }
]

function createMockDrizzle(rows) {
  const chain = {
    orderBy: vi.fn().mockResolvedValue(rows)
  }

  chain.where = vi.fn().mockReturnValue({
    orderBy: chain.orderBy
  })

  chain.from = vi.fn().mockReturnValue({
    where: chain.where
  })

  return {
    select: vi.fn().mockReturnValue(chain),
    _chain: chain
  }
}

// The user is taken from the verified token (`sub`), not the path param.
function makeRequest(sub, query = {}, credentials = {}) {
  return {
    drizzle: createMockDrizzle(mockUserProjects),
    auth: { credentials: { sub, ...credentials } },
    params: { userId: sub },
    query: { sort: 'updated_at', order: 'desc', ...query }
  }
}

// Claims for a user who holds an approved 'bng completer' role in BOTH orgs but
// is currently signed in under `current`.
function multiOrgClaims(current) {
  return {
    currentRelationshipId: current,
    relationships: [
      `${REL_CURRENT}:org-current:Acme Ltd:0:Employee:1`,
      `${REL_OTHER}:org-other:Globex:0:Employee:1`
    ],
    roles: [`${REL_CURRENT}:bng completer:3`, `${REL_OTHER}:bng completer:3`]
  }
}

function renderWhere(request) {
  const [predicate] = request.drizzle._chain.where.mock.calls[0]
  return new PgDialect().sqlToQuery(predicate)
}

describe('#getUserProjects', () => {
  test('Should return the projects visible to the token subject', async () => {
    const request = makeRequest(TEST_USER_ID)

    const result = await getUserProjects.handler(request, {})

    expect(request.drizzle.select).toHaveBeenCalled()
    expect(request.drizzle._chain.where).toHaveBeenCalled()
    expect(result).toEqual(mockUserProjects)
  })

  test('Should return empty array when no projects are visible', async () => {
    const drizzle = createMockDrizzle([])
    drizzle._chain.orderBy.mockResolvedValue([])
    const request = {
      drizzle,
      auth: { credentials: { sub: UNKNOWN_USER_ID } },
      params: { userId: UNKNOWN_USER_ID },
      query: { sort: 'updated_at', order: 'desc' }
    }

    const result = await getUserProjects.handler(request, {})

    expect(result).toEqual([])
  })

  test('Should scope the query with the visibility predicate (once)', async () => {
    const request = makeRequest(TEST_USER_ID)

    await getUserProjects.handler(request, {})

    // Filtering semantics (owner + approved role / legacy null) are covered by
    // the integration tests against real Postgres.
    expect(request.drizzle._chain.where).toHaveBeenCalledTimes(1)
  })

  // BMD-890: a user approved in two orgs must only see the current one's
  // projects. The list endpoint is where the leak was visible.
  test('Should scope the list to the org the user is currently signed in as', async () => {
    const request = makeRequest(TEST_USER_ID, {}, multiOrgClaims(REL_CURRENT))

    await getUserProjects.handler(request, {})

    const { sql: whereSql, params } = renderWhere(request)
    expect(whereSql).toContain('"relationship_id" is not distinct from')
    expect(params).toContain(REL_CURRENT)
    expect(params).not.toContain(REL_OTHER)
  })

  test('Should follow the user when they switch org context', async () => {
    const request = makeRequest(TEST_USER_ID, {}, multiOrgClaims(REL_OTHER))

    await getUserProjects.handler(request, {})

    const { params } = renderWhere(request)
    expect(params).toContain(REL_OTHER)
    expect(params).not.toContain(REL_CURRENT)
  })

  test('Should include updatedAt in returned projects', async () => {
    const request = makeRequest(TEST_USER_ID)

    const result = await getUserProjects.handler(request, {})

    expect(result[0].updatedAt).toEqual(new Date('2024-01-02'))
    expect(result[1].updatedAt).toEqual(new Date('2024-02-02'))
  })

  test('Should call orderBy on the query', async () => {
    const request = makeRequest(TEST_USER_ID)

    await getUserProjects.handler(request, {})

    expect(request.drizzle._chain.orderBy).toHaveBeenCalledOnce()
  })

  test.each([
    ['created_at', 'asc', () => asc(projects.createdAt)],
    ['created_at', 'desc', () => desc(projects.createdAt)],
    ['updated_at', 'asc', () => asc(projects.updatedAt)],
    ['updated_at', 'desc', () => desc(projects.updatedAt)],
    ['name', 'asc', () => asc(sql`${projects.project}->>'name'`)],
    ['name', 'desc', () => desc(sql`${projects.project}->>'name'`)]
  ])('Should call orderBy with %s %s', async (sort, order, expectedExpr) => {
    const request = makeRequest(TEST_USER_ID, { sort, order })

    await getUserProjects.handler(request, {})

    expect(request.drizzle._chain.orderBy).toHaveBeenCalledWith(expectedExpr())
  })
})

describe('#getUserProjects params validation', () => {
  const schema = getUserProjects.options.validate.params

  test('Should accept a UUID', () => {
    const { error } = schema.validate({ userId: TEST_USER_ID })
    expect(error).toBeUndefined()
  })

  test('Should accept a non-UUID string (Defra sub is not a UUID)', () => {
    const { error } = schema.validate({ userId: 'colin-test-003' })
    expect(error).toBeUndefined()
  })

  test('Should reject an empty userId', () => {
    const { error } = schema.validate({ userId: '' })
    expect(error).toBeDefined()
  })

  test('Should reject a missing userId', () => {
    const { error } = schema.validate({})
    expect(error).toBeDefined()
    expect(error.message).toContain('"userId" is required')
  })
})

describe('#getUserProjects query validation', () => {
  const schema = getUserProjects.options.validate.query

  test('Should default sort to updated_at and order to desc', () => {
    const { error, value } = schema.validate({})
    expect(error).toBeUndefined()
    expect(value).toEqual({ sort: 'updated_at', order: 'desc' })
  })

  test.each([
    ['created_at', 'asc'],
    ['created_at', 'desc'],
    ['updated_at', 'asc'],
    ['updated_at', 'desc'],
    ['name', 'asc'],
    ['name', 'desc']
  ])('Should accept sort=%s order=%s', (sort, order) => {
    const { error } = schema.validate({ sort, order })
    expect(error).toBeUndefined()
  })

  // Invalid values are rejected before the handler runs; Hapi returns a 400
  test('Should reject a misspelled sort value', () => {
    const { error } = schema.validate({ sort: 'created_att' })
    expect(error).toBeDefined()
    expect(error.message).toContain(
      '"sort" must be one of [created_at, updated_at, name]'
    )
  })

  test('Should reject an unrecognised sort value', () => {
    const { error } = schema.validate({ sort: 'bng_project_version' })
    expect(error).toBeDefined()
    expect(error.message).toContain(
      '"sort" must be one of [created_at, updated_at, name]'
    )
  })

  test('Should reject a misspelled order value', () => {
    const { error } = schema.validate({ order: 'ascc' })
    expect(error).toBeDefined()
    expect(error.message).toContain('"order" must be one of [asc, desc]')
  })

  test('Should reject an unrecognised order value', () => {
    const { error } = schema.validate({ order: 'sideways' })
    expect(error).toBeDefined()
    expect(error.message).toContain('"order" must be one of [asc, desc]')
  })
})
