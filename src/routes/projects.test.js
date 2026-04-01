import { getProjects, getProject } from './projects.js'

const mockProjects = [
  {
    id: 'aaa-bbb-ccc',
    project: {
      name: 'Greenfield Meadow Restoration',
      site: { name: 'Greenfield Meadow', grid_ref: 'TQ 123 456' },
      units: { habitat: 10.5, hedgerow: 2.3, watercourse: 0.8 }
    },
    userId: 'test-user-001',
    bngProjectVersion: 1,
    createdAt: new Date('2024-01-01')
  },
  {
    id: 'ddd-eee-fff',
    project: {
      name: 'Oakwood Farm BNG Assessment',
      site: { name: 'Oakwood Farm', grid_ref: 'SP 987 654' },
      units: { habitat: 25.0, hedgerow: 8.1 }
    },
    userId: 'test-user-002',
    bngProjectVersion: 2,
    createdAt: new Date('2024-02-01')
  }
]

function createMockDrizzle(rows) {
  const chain = {
    where: vi.fn().mockResolvedValue(rows)
  }

  // from() returns a thenable that also has .where()
  chain.from = vi.fn().mockReturnValue({
    then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
    where: chain.where
  })

  return {
    select: vi.fn().mockReturnValue(chain),
    _chain: chain
  }
}

describe('#getProjects', () => {
  test('Should return all projects', async () => {
    const drizzle = createMockDrizzle(mockProjects)
    const request = { drizzle }

    const result = await getProjects.handler(request, {})

    expect(drizzle.select).toHaveBeenCalled()
    expect(result).toEqual(mockProjects)
  })

  test('Should return empty array when no projects exist', async () => {
    const drizzle = createMockDrizzle([])
    const request = { drizzle }

    const result = await getProjects.handler(request, {})

    expect(result).toEqual([])
  })
})

describe('#getProject', () => {
  test('Should return a single project by id', async () => {
    const drizzle = createMockDrizzle([mockProjects[0]])
    const request = {
      drizzle,
      params: { id: 'aaa-bbb-ccc' }
    }

    const result = await getProject.handler(request, {})

    expect(drizzle.select).toHaveBeenCalled()
    expect(drizzle._chain.where).toHaveBeenCalled()
    expect(result).toEqual(mockProjects[0])
  })

  test('Should throw 404 when project not found', async () => {
    const drizzle = createMockDrizzle([])
    const request = {
      drizzle,
      params: { id: 'nonexistent-id' }
    }

    await expect(getProject.handler(request, {})).rejects.toThrow(
      'Project nonexistent-id not found'
    )
  })
})
