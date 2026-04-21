import { asc, desc, eq, sql } from 'drizzle-orm'
import { getUserProjects } from './users.js'
import { projects } from '../db/schema/index.js'

const TEST_USER_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
const UNKNOWN_USER_ID = '00000000-0000-0000-0000-000000000000'

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
      units: { habitat: 25.0, hedgerow: 8.1 }
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

function makeRequest(userId, query = {}) {
  return {
    drizzle: createMockDrizzle(mockUserProjects),
    params: { userId },
    query: { sort: 'updated_at', order: 'desc', ...query }
  }
}

describe('#getUserProjects', () => {
  test('Should return all projects for a given userId', async () => {
    const request = makeRequest(TEST_USER_ID)

    const result = await getUserProjects.handler(request, {})

    expect(request.drizzle.select).toHaveBeenCalled()
    expect(request.drizzle._chain.where).toHaveBeenCalled()
    expect(result).toEqual(mockUserProjects)
  })

  test('Should return empty array when no projects found for userId', async () => {
    const drizzle = createMockDrizzle([])
    drizzle._chain.orderBy.mockResolvedValue([])
    const request = {
      drizzle,
      params: { userId: UNKNOWN_USER_ID },
      query: { sort: 'updated_at', order: 'desc' }
    }

    const result = await getUserProjects.handler(request, {})

    expect(result).toEqual([])
  })

  test('Should filter projects by the correct userId', async () => {
    const request = makeRequest(TEST_USER_ID)

    await getUserProjects.handler(request, {})

    expect(request.drizzle._chain.where).toHaveBeenCalledWith(
      eq(projects.userId, TEST_USER_ID)
    )
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

  test('Should accept a valid UUID', () => {
    const { error } = schema.validate({ userId: TEST_USER_ID })
    expect(error).toBeUndefined()
  })

  test('Should reject a non-UUID string', () => {
    const { error } = schema.validate({ userId: 'colin-test-003' })
    expect(error).toBeDefined()
    expect(error.message).toContain('"userId" must be a valid GUID')
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
