import { describe, test, expect, vi } from 'vitest'
import { asc, desc, sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { getUserProjects } from './users.js'
import { projects } from '../db/schema/index.js'
import {
  projectListColumns,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT
} from '../db/project-list.js'

const TEST_USER_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
const UNKNOWN_USER_ID = '00000000-0000-0000-0000-000000000000'
const REL_CURRENT = 'rel-current-org'
const REL_OTHER = 'rel-other-org'
// Comfortably above two projected rows, far below any real project document.
const MAX_LIST_PAYLOAD_BYTES = 1000

const PROJECT_1_ID = 'aaa11111-0000-0000-0000-000000000001'
const PROJECT_2_ID = 'bbb22222-0000-0000-0000-000000000002'

// Rows as they come back through projectListColumns — the projection, not the
// bng.projects row: the `project` JSONB document is never selected (BMD-933).
const mockUserProjects = [
  {
    id: PROJECT_1_ID,
    name: 'Greenfield Meadow Restoration',
    hasBaseline: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02')
  },
  {
    id: PROJECT_2_ID,
    name: 'Oakwood Farm BNG Assessment',
    hasBaseline: false,
    createdAt: new Date('2024-02-01'),
    updatedAt: new Date('2024-02-02')
  }
]

const expectedResponse = [
  {
    id: PROJECT_1_ID,
    projectId: PROJECT_1_ID,
    project: { name: 'Greenfield Meadow Restoration' },
    has_baseline: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02')
  },
  {
    id: PROJECT_2_ID,
    projectId: PROJECT_2_ID,
    project: { name: 'Oakwood Farm BNG Assessment' },
    has_baseline: false,
    createdAt: new Date('2024-02-01'),
    updatedAt: new Date('2024-02-02')
  }
]

function createMockDrizzle(rows) {
  const chain = {
    offset: vi.fn().mockResolvedValue(rows)
  }

  chain.limit = vi.fn().mockReturnValue({ offset: chain.offset })
  chain.orderBy = vi.fn().mockReturnValue({ limit: chain.limit })
  chain.where = vi.fn().mockReturnValue({ orderBy: chain.orderBy })
  chain.from = vi.fn().mockReturnValue({ where: chain.where })

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
    query: {
      sort: 'updated_at',
      order: 'desc',
      limit: DEFAULT_LIST_LIMIT,
      offset: 0,
      ...query
    }
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
    expect(result).toEqual(expectedResponse)
  })

  test('Should return empty array when no projects are visible', async () => {
    const drizzle = createMockDrizzle([])
    const request = {
      drizzle,
      auth: { credentials: { sub: UNKNOWN_USER_ID } },
      params: { userId: UNKNOWN_USER_ID },
      query: {
        sort: 'updated_at',
        order: 'desc',
        limit: DEFAULT_LIST_LIMIT,
        offset: 0
      }
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
  //
  // BMD-936 (revised): the scope follows the VERIFIED TOKEN, with bng.users only
  // as a fallback. That is what lets the same user hold concurrent sessions in
  // two orgs — the stored row remembers one org, the tokens remember one each.
  test.each([
    ['signed in as one org', REL_CURRENT, REL_OTHER],
    ['switched to the other org', REL_OTHER, REL_CURRENT]
  ])(
    'Should scope the list to the token org when %s',
    async (_name, signedInAs, otherOrg) => {
      const request = makeRequest(TEST_USER_ID, {}, multiOrgClaims(signedInAs))

      await getUserProjects.handler(request, {})

      const { sql: whereSql, params } = renderWhere(request)
      expect(whereSql).toContain('is not distinct from')
      expect(params).toContain(signedInAs)
      expect(params).not.toContain(otherOrg)
    }
  )

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

    // The id tiebreak makes the order total, so limit/offset pages are stable.
    expect(request.drizzle._chain.orderBy).toHaveBeenCalledWith(
      expectedExpr(),
      asc(projects.id)
    )
  })
})

// BMD-933: the list page renders name + timestamps + a link target. Selecting
// the whole row shipped the entire project document (megabytes at scale) to
// render three columns.
describe('#getUserProjects list projection', () => {
  test('Should select only the list columns, never the project document', async () => {
    const request = makeRequest(TEST_USER_ID)

    await getUserProjects.handler(request, {})

    expect(request.drizzle.select).toHaveBeenCalledWith(projectListColumns)
  })

  test('Should exclude the document body from the payload', async () => {
    const request = makeRequest(TEST_USER_ID)

    const result = await getUserProjects.handler(request, {})

    for (const row of result) {
      expect(row.project).toEqual({ name: expect.any(String) })
      expect(row.project).not.toHaveProperty('baseline')
      expect(row.project).not.toHaveProperty('postIntervention')
    }
  })

  test('Should include has_baseline for each row', async () => {
    const request = makeRequest(TEST_USER_ID)

    const result = await getUserProjects.handler(request, {})

    expect(result.map((r) => r.has_baseline)).toEqual([true, false])
  })

  test('Should keep the payload flat however large the stored document is', async () => {
    // The projection is applied in Postgres, so a 31 MB baseline never reaches
    // Node: the row the handler sees carries the same five projected fields.
    const request = makeRequest(TEST_USER_ID)

    const result = await getUserProjects.handler(request, {})

    expect(JSON.stringify(result).length).toBeLessThan(MAX_LIST_PAYLOAD_BYTES)
  })
})

describe('#getUserProjects pagination', () => {
  test('Should apply the requested limit and offset', async () => {
    const request = makeRequest(TEST_USER_ID, { limit: 25, offset: 50 })

    await getUserProjects.handler(request, {})

    expect(request.drizzle._chain.limit).toHaveBeenCalledWith(25)
    expect(request.drizzle._chain.offset).toHaveBeenCalledWith(50)
  })

  test('Should always bound the query, even for a caller that asks for neither', async () => {
    const request = makeRequest(TEST_USER_ID)

    await getUserProjects.handler(request, {})

    expect(request.drizzle._chain.limit).toHaveBeenCalledWith(
      DEFAULT_LIST_LIMIT
    )
    expect(request.drizzle._chain.offset).toHaveBeenCalledWith(0)
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

  test('Should default sort, order, limit and offset', () => {
    const { error, value } = schema.validate({})
    expect(error).toBeUndefined()
    expect(value).toEqual({
      sort: 'updated_at',
      order: 'desc',
      limit: DEFAULT_LIST_LIMIT,
      offset: 0
    })
  })

  test.each([
    [{ limit: 1 }],
    [{ limit: MAX_LIST_LIMIT }],
    [{ offset: 0 }],
    [{ offset: 10_000 }],
    [{ limit: 20, offset: 40 }]
  ])('Should accept %o', (query) => {
    const { error } = schema.validate(query)
    expect(error).toBeUndefined()
  })

  test('Should reject a limit above the cap', () => {
    const { error } = schema.validate({ limit: MAX_LIST_LIMIT + 1 })
    expect(error).toBeDefined()
    expect(error.message).toContain(
      `"limit" must be less than or equal to ${MAX_LIST_LIMIT}`
    )
  })

  test('Should reject a zero or negative limit', () => {
    expect(schema.validate({ limit: 0 }).error).toBeDefined()
    expect(schema.validate({ limit: -1 }).error).toBeDefined()
  })

  test('Should reject a negative offset', () => {
    const { error } = schema.validate({ offset: -1 })
    expect(error).toBeDefined()
    expect(error.message).toContain(
      '"offset" must be greater than or equal to 0'
    )
  })

  test('Should reject a non-integer limit', () => {
    const { error } = schema.validate({ limit: 1.5 })
    expect(error).toBeDefined()
    expect(error.message).toContain('"limit" must be an integer')
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
