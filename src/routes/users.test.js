import { getUserProjects } from './users.js'

const mockUserProjects = [
  {
    id: 'aaa-bbb-ccc',
    project: {
      name: 'Greenfield Meadow Restoration',
      site: { name: 'Greenfield Meadow', grid_ref: 'TQ 123 456' },
      units: { habitat: 10.5, hedgerow: 2.3, watercourse: 0.8 }
    },
    userId: 'test-user-001',
    bngProjectVersion: 1,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02')
  },
  {
    id: 'ddd-eee-fff',
    project: {
      name: 'Oakwood Farm BNG Assessment',
      site: { name: 'Oakwood Farm', grid_ref: 'SP 987 654' },
      units: { habitat: 25.0, hedgerow: 8.1 }
    },
    userId: 'test-user-001',
    bngProjectVersion: 1,
    createdAt: new Date('2024-02-01'),
    updatedAt: new Date('2024-02-02')
  }
]

function createMockDrizzle(rows) {
  const chain = {
    where: vi.fn().mockResolvedValue(rows)
  }

  chain.from = vi.fn().mockReturnValue({
    then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
    where: chain.where
  })

  return {
    select: vi.fn().mockReturnValue(chain),
    _chain: chain
  }
}

describe('#getUserProjects', () => {
  test('Should return all projects for a given userId', async () => {
    const drizzle = createMockDrizzle(mockUserProjects)
    const request = { drizzle, params: { userId: 'test-user-001' } }

    const result = await getUserProjects.handler(request, {})

    expect(drizzle.select).toHaveBeenCalled()
    expect(drizzle._chain.where).toHaveBeenCalled()
    expect(result).toEqual(mockUserProjects)
  })

  test('Should return empty array when user has no projects', async () => {
    const drizzle = createMockDrizzle([])
    const request = { drizzle, params: { userId: 'test-user-999' } }

    const result = await getUserProjects.handler(request, {})

    expect(result).toEqual([])
  })

  test('Should filter projects by the userId param', async () => {
    const drizzle = createMockDrizzle(mockUserProjects)
    const request = { drizzle, params: { userId: 'test-user-001' } }

    await getUserProjects.handler(request, {})

    expect(drizzle._chain.where).toHaveBeenCalledOnce()
    const results = await drizzle._chain.where.mock.results[0].value
    expect(results.every((r) => r.userId === 'test-user-001')).toBe(true)
  })

  test('Should include updatedAt in returned projects', async () => {
    const drizzle = createMockDrizzle(mockUserProjects)
    const request = { drizzle, params: { userId: 'test-user-001' } }

    const result = await getUserProjects.handler(request, {})

    expect(result[0].updatedAt).toEqual(new Date('2024-01-02'))
    expect(result[1].updatedAt).toEqual(new Date('2024-02-02'))
  })
})
