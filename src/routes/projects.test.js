import {
  getProjects,
  getProject,
  createProject,
  updateProject
} from './projects.js'

const mockProjects = [
  {
    id: '3f1e45b4-2e81-4c70-8a70-083ad958c913',
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
    id: '52116043-fb84-4144-8bf0-92890a4fe7a6',
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

describe('#createProject', () => {
  function createMockDrizzleInsert(row) {
    return {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([row])
        })
      })
    }
  }

  const newProject = {
    id: '3d0f7b2e-4c52-4e0e-a20a-708dfc9b42d1',
    project: { name: 'New Wetland Project' },
    userId: 'test-user-003',
    bngProjectVersion: 1,
    createdAt: new Date('2024-03-01')
  }

  test('Should insert and return the created project', async () => {
    const drizzle = createMockDrizzleInsert(newProject)
    const request = {
      drizzle,
      payload: {
        project: { name: 'New Wetland Project' },
        userId: 'test-user-003'
      }
    }

    const result = await createProject.handler(request, {})

    expect(drizzle.insert).toHaveBeenCalled()
    expect(result).toEqual(newProject)
  })

  test('Should pass only project and userId to drizzle', async () => {
    const drizzle = createMockDrizzleInsert(newProject)
    const payload = {
      project: { name: 'New Wetland Project' },
      userId: 'test-user-003'
    }
    const request = { drizzle, payload }

    await createProject.handler(request, {})

    const valuesSpy = drizzle.insert().values
    const insertedValues = valuesSpy.mock.calls[0][0]
    expect(insertedValues).toEqual({
      project: payload.project,
      userId: payload.userId
    })
  })
})

describe('#createProject validation', () => {
  const schema = createProject.options.validate.payload

  test('Should pass with valid payload using userId', async () => {
    const { error } = schema.validate({
      project: { name: 'Test Project' },
      userId: 'test-user-001'
    })
    expect(error).toBeUndefined()
  })

  test('Should pass with valid payload using user_id (renamed to userId)', async () => {
    const { error, value } = schema.validate({
      project: { name: 'Test Project' },
      user_id: 'test-user-001'
    })
    expect(error).toBeUndefined()
    expect(value.userId).toBe('test-user-001')
  })

  test('Should fail when project is missing', async () => {
    const { error } = schema.validate({ userId: 'test-user-001' })
    expect(error).toBeDefined()
    expect(error.message).toContain('"project" is required')
  })

  test('Should fail when user_id and userId are both missing', async () => {
    const { error } = schema.validate({ project: { name: 'Test Project' } })
    expect(error).toBeDefined()
    expect(error.message).toContain('"userId" is required')
  })

  test('Should fail when project is not an object', async () => {
    const { error } = schema.validate({
      project: 'not-an-object',
      userId: 'test-user-001'
    })
    expect(error).toBeDefined()
    expect(error.message).toContain('"project" must be of type object')
  })
})

describe('#getProject', () => {
  test('Should return a single project by id', async () => {
    const drizzle = createMockDrizzle([mockProjects[0]])
    const request = {
      drizzle,
      params: { id: '3f1e45b4-2e81-4c70-8a70-083ad958c913' }
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
      params: { id: 'a7dc53f2-05d2-4d75-9186-7e5cf52864bd' }
    }

    await expect(getProject.handler(request, {})).rejects.toThrow(
      'Project a7dc53f2-05d2-4d75-9186-7e5cf52864bd not found'
    )
  })
})

describe('#getProject validation', () => {
  const paramsSchema = getProject.options.validate.params

  test('Should pass with a UUID id param', async () => {
    const { error } = paramsSchema.validate({
      id: '3f1e45b4-2e81-4c70-8a70-083ad958c913'
    })
    expect(error).toBeUndefined()
  })

  test('Should fail when id param is not a UUID', async () => {
    const { error } = paramsSchema.validate({ id: 'not-a-uuid' })
    expect(error).toBeDefined()
    expect(error.message).toContain('"id" must be a valid GUID')
  })
})

describe('#updateProject', () => {
  function createMockDrizzleUpdate(rows) {
    const returning = vi.fn().mockResolvedValue(rows)
    const where = vi.fn().mockReturnValue({ returning })
    const set = vi.fn().mockReturnValue({ where })

    return {
      update: vi.fn().mockReturnValue({ set }),
      _chain: { set, where, returning }
    }
  }

  test('Should update project name and return the updated project', async () => {
    const updatedProject = {
      ...mockProjects[0],
      project: {
        ...mockProjects[0].project,
        name: 'Renamed Project'
      }
    }
    const drizzle = createMockDrizzleUpdate([updatedProject])
    const request = {
      drizzle,
      params: { id: '3f1e45b4-2e81-4c70-8a70-083ad958c913' },
      payload: {
        project: { name: 'Renamed Project' },
        userId: 'test-user-001'
      }
    }

    const result = await updateProject.handler(request, {})

    expect(drizzle.update).toHaveBeenCalled()
    expect(drizzle._chain.set).toHaveBeenCalledWith({
      project: expect.anything(),
      updatedAt: expect.anything()
    })
    expect(drizzle._chain.where).toHaveBeenCalled()
    expect(result).toEqual(updatedProject)
  })

  test('Should throw 404 when project to update is not found', async () => {
    const drizzle = createMockDrizzleUpdate([])
    const request = {
      drizzle,
      params: { id: 'a7dc53f2-05d2-4d75-9186-7e5cf52864bd' },
      payload: {
        project: { name: 'Renamed Project' },
        userId: 'test-user-001'
      }
    }

    await expect(updateProject.handler(request, {})).rejects.toThrow(
      'Project a7dc53f2-05d2-4d75-9186-7e5cf52864bd not found'
    )
  })
})

describe('#updateProject validation', () => {
  const payloadSchema = updateProject.options.validate.payload
  const paramsSchema = updateProject.options.validate.params

  test('Should pass with a valid name', async () => {
    const { error } = payloadSchema.validate({
      project: { name: 'Renamed Project' },
      userId: 'test-user-001'
    })
    expect(error).toBeUndefined()
  })

  test('Should fail when name is missing', async () => {
    const { error } = payloadSchema.validate({
      project: {},
      userId: 'test-user-001'
    })
    expect(error).toBeDefined()
    expect(error.message).toContain('"project.name" is required')
  })

  test('Should fail when name is empty', async () => {
    const { error } = payloadSchema.validate({
      project: { name: '' },
      userId: 'test-user-001'
    })
    expect(error).toBeDefined()
    expect(error.message).toContain('"project.name" is not allowed to be empty')
  })

  test('Should require an id param', async () => {
    const { error } = paramsSchema.validate({})
    expect(error).toBeDefined()
    expect(error.message).toContain('"id" is required')
  })

  test('Should pass with a UUID id param', async () => {
    const { error } = paramsSchema.validate({
      id: '3f1e45b4-2e81-4c70-8a70-083ad958c913'
    })
    expect(error).toBeUndefined()
  })

  test('Should fail when id param is not a UUID', async () => {
    const { error } = paramsSchema.validate({ id: 'not-a-uuid' })
    expect(error).toBeDefined()
    expect(error.message).toContain('"id" must be a valid GUID')
  })
})
