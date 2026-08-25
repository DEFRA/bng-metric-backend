import { describe, test, expect, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import {
  getProjects,
  getProject,
  getHabitat,
  createProject,
  updateProject
} from './projects.js'
import {
  projectListColumns,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT
} from '../db/project-list.js'

const PROJECT_1_ID = '3f1e45b4-2e81-4c70-8a70-083ad958c913'
const UNKNOWN_PROJECT_ID = 'a7dc53f2-05d2-4d75-9186-7e5cf52864bd'
const USER_001 = 'test-user-001'
const USER_003 = 'test-user-003'
const NEW_PROJECT_NAME = 'New Wetland Project'
const RENAMED_NAME = 'Renamed Project'

const REL_A = 'rel-org-a'
const REL_B = 'rel-org-b'

// Verified-token credentials as they reach the handler via request.auth.
const credsFor = (sub, extra = {}) => ({
  auth: { credentials: { sub, ...extra } }
})

// Claims for a user approved in BOTH orgs, currently signed in under `current`.
const multiOrgClaims = (current) => ({
  currentRelationshipId: current,
  relationships: [
    `${REL_A}:org-a:Acme Ltd:0:Employee:1`,
    `${REL_B}:org-b:Globex:0:Employee:1`
  ],
  roles: [`${REL_A}:bng completer:3`, `${REL_B}:bng completer:3`]
})

function renderWhere(whereSpy) {
  const [predicate] = whereSpy.mock.calls[0]
  return new PgDialect().sqlToQuery(predicate)
}

const PROJECT_2_ID = '52116043-fb84-4144-8bf0-92890a4fe7a6'

const mockProjects = [
  {
    id: PROJECT_1_ID,
    project: {
      name: 'Greenfield Meadow Restoration',
      site: { name: 'Greenfield Meadow', grid_ref: 'TQ 123 456' },
      units: { habitat: 10.5, hedgerow: 2.3, watercourse: 0.8 }
    },
    userId: USER_001,
    bngProjectVersion: 1,
    createdAt: new Date('2024-01-01')
  },
  {
    id: PROJECT_2_ID,
    project: {
      name: 'Oakwood Farm BNG Assessment',
      site: { name: 'Oakwood Farm', grid_ref: 'SP 987 654' },
      units: { habitat: 25, hedgerow: 8.1 }
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

// Rows as they come back through projectListColumns — the `project` JSONB
// document is not selected at all on the list path (BMD-933).
const mockProjectListRows = [
  {
    id: PROJECT_1_ID,
    name: 'Greenfield Meadow Restoration',
    hasBaseline: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-03')
  },
  {
    id: PROJECT_2_ID,
    name: 'Oakwood Farm BNG Assessment',
    hasBaseline: false,
    createdAt: new Date('2024-02-01'),
    updatedAt: new Date('2024-02-03')
  }
]

// select().from().where().orderBy().limit().offset()
function createMockListDrizzle(rows) {
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

function listRequest(sub, query = {}, extra = {}) {
  return {
    drizzle: createMockListDrizzle(mockProjectListRows),
    query: { limit: DEFAULT_LIST_LIMIT, offset: 0, ...query },
    ...credsFor(sub, extra)
  }
}

describe('#getProjects', () => {
  test('Should return the projects visible to the user', async () => {
    const request = listRequest(USER_001)

    const result = await getProjects.handler(request, {})

    expect(request.drizzle.select).toHaveBeenCalled()
    expect(request.drizzle._chain.where).toHaveBeenCalled()
    expect(result).toEqual([
      {
        id: PROJECT_1_ID,
        projectId: PROJECT_1_ID,
        project: { name: 'Greenfield Meadow Restoration' },
        has_baseline: true,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-03')
      },
      {
        id: PROJECT_2_ID,
        projectId: PROJECT_2_ID,
        project: { name: 'Oakwood Farm BNG Assessment' },
        has_baseline: false,
        createdAt: new Date('2024-02-01'),
        updatedAt: new Date('2024-02-03')
      }
    ])
  })

  test('Should return empty array when no projects are visible', async () => {
    const request = listRequest(USER_001)
    request.drizzle._chain.offset.mockResolvedValue([])

    const result = await getProjects.handler(request, {})

    expect(result).toEqual([])
  })

  // BMD-890: holding an approved role in a second org must not widen the list —
  // only the relationship the user is currently signed in as is queried.
  // BMD-936: the org scope comes from bng.users, not from the token — see
  // currentRelationshipExpr in db/project-visibility.js.
  test('Should scope the query to the stored org context only', async () => {
    const request = listRequest(USER_001, {}, multiOrgClaims(REL_A))

    await getProjects.handler(request, {})

    const { sql, params } = renderWhere(request.drizzle._chain.where)
    expect(sql).toContain('"relationship_id" is not distinct from')
    expect(sql).toContain('u.current_relationship_id')
    expect(params).not.toContain(REL_A)
    expect(params).not.toContain(REL_B)
  })
})

// BMD-933 — see the same suite in users.test.js; both list endpoints share the
// projection and the paging bounds.
describe('#getProjects list projection', () => {
  test('Should select only the list columns, never the project document', async () => {
    const request = listRequest(USER_001)

    await getProjects.handler(request, {})

    expect(request.drizzle.select).toHaveBeenCalledWith(projectListColumns)
  })

  test('Should exclude the document body from the payload', async () => {
    const request = listRequest(USER_001)

    const result = await getProjects.handler(request, {})

    for (const row of result) {
      expect(row.project).toEqual({ name: expect.any(String) })
      expect(row.project).not.toHaveProperty('baseline')
      expect(row.project).not.toHaveProperty('postIntervention')
    }
  })

  test('Should include has_baseline for each row', async () => {
    const request = listRequest(USER_001)

    const result = await getProjects.handler(request, {})

    expect(result.map((r) => r.has_baseline)).toEqual([true, false])
  })

  test('Should order the rows so paging is stable', async () => {
    const request = listRequest(USER_001)

    await getProjects.handler(request, {})

    expect(request.drizzle._chain.orderBy).toHaveBeenCalledOnce()
    expect(request.drizzle._chain.orderBy.mock.calls[0]).toHaveLength(2)
  })
})

describe('#getProjects pagination', () => {
  test('Should apply the requested limit and offset', async () => {
    const request = listRequest(USER_001, { limit: 25, offset: 50 })

    await getProjects.handler(request, {})

    expect(request.drizzle._chain.limit).toHaveBeenCalledWith(25)
    expect(request.drizzle._chain.offset).toHaveBeenCalledWith(50)
  })

  test('Should always bound the query, even for a caller that asks for neither', async () => {
    const request = listRequest(USER_001)

    await getProjects.handler(request, {})

    expect(request.drizzle._chain.limit).toHaveBeenCalledWith(
      DEFAULT_LIST_LIMIT
    )
    expect(request.drizzle._chain.offset).toHaveBeenCalledWith(0)
  })
})

describe('#getProjects query validation', () => {
  const schema = getProjects.options.validate.query

  test('Should default limit and offset', () => {
    const { error, value } = schema.validate({})
    expect(error).toBeUndefined()
    expect(value).toEqual({ limit: DEFAULT_LIST_LIMIT, offset: 0 })
  })

  test('Should accept a limit at the cap', () => {
    const { error } = schema.validate({ limit: MAX_LIST_LIMIT })
    expect(error).toBeUndefined()
  })

  test('Should reject a limit above the cap', () => {
    const { error } = schema.validate({ limit: MAX_LIST_LIMIT + 1 })
    expect(error).toBeDefined()
    expect(error.message).toContain(
      `"limit" must be less than or equal to ${MAX_LIST_LIMIT}`
    )
  })

  test('Should reject a negative offset', () => {
    const { error } = schema.validate({ offset: -1 })
    expect(error).toBeDefined()
    expect(error.message).toContain(
      '"offset" must be greater than or equal to 0'
    )
  })
})

// `storedOrgContext` is what bng.users / bng.relationships hold for the user —
// the fallback createProject reads when the token carries no current
// relationship. Left empty for a user with no persisted session.
function createMockDrizzleInsert(row, storedOrgContext = []) {
  const limit = vi.fn().mockResolvedValue(storedOrgContext)
  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([row])
      })
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit })
        })
      })
    }),
    _orgContextLimit: limit
  }
}

describe('#createProject', () => {
  const newProject = {
    id: '3d0f7b2e-4c52-4e0e-a20a-708dfc9b42d1',
    project: { name: NEW_PROJECT_NAME },
    userId: USER_003,
    bngProjectVersion: 1,
    createdAt: new Date('2024-03-01')
  }

  test('Should insert and return the created project', async () => {
    const drizzle = createMockDrizzleInsert(newProject)
    const request = {
      drizzle,
      ...credsFor(USER_003),
      payload: { project: { name: NEW_PROJECT_NAME } }
    }

    const result = await createProject.handler(request, {})

    expect(drizzle.insert).toHaveBeenCalled()
    expect(result).toEqual({ ...newProject, projectId: newProject.id })
  })

  test('Should derive userId from the token and stamp the stored org context', async () => {
    const drizzle = createMockDrizzleInsert(newProject, [
      { relationshipId: 'rel-9', orgId: 'org-9' }
    ])
    const request = {
      drizzle,
      ...credsFor(USER_003, {
        currentRelationshipId: 'rel-9',
        relationships: ['rel-9:org-9:Acme Ltd:0:Employee:1']
      }),
      payload: { project: { name: NEW_PROJECT_NAME } }
    }

    await createProject.handler(request, {})

    const valuesSpy = drizzle.insert().values
    const insertedValues = valuesSpy.mock.calls[0][0]
    expect(insertedValues).toEqual({
      project: { name: NEW_PROJECT_NAME },
      userId: USER_003,
      lastModifiedBy: USER_003,
      orgId: 'org-9',
      relationshipId: 'rel-9'
    })
  })

  // BMD-936: the stored context wins outright. A refresh_token grant's id_token
  // can name a different relationship from the one the user signed in under —
  // stamping that would put the project outside the scope it is read back
  // through, so it would vanish the moment it was created.
  test('Should stamp the stored context, not a conflicting one from the token', async () => {
    const drizzle = createMockDrizzleInsert(newProject, [
      { relationshipId: 'rel-signed-in', orgId: 'org-signed-in' }
    ])
    const request = {
      drizzle,
      ...credsFor(USER_003, {
        currentRelationshipId: 'rel-9',
        relationships: ['rel-9:org-9:Acme Ltd:0:Employee:1']
      }),
      payload: { project: { name: NEW_PROJECT_NAME } }
    }

    await createProject.handler(request, {})

    expect(drizzle.select).toHaveBeenCalled()
    expect(drizzle.insert().values.mock.calls[0][0]).toMatchObject({
      relationshipId: 'rel-signed-in',
      orgId: 'org-signed-in'
    })
  })

  // BMD-890: the create path must resolve the org context exactly as the read
  // path does. A refreshed id_token can arrive with the enrichment claims blank;
  // stamping null then would hide the project from its own creator instantly,
  // because the read scope falls back to the stored relationship.
  test('Should stamp the stored org context when the token has none', async () => {
    const drizzle = createMockDrizzleInsert(newProject, [
      { relationshipId: 'rel-stored', orgId: 'org-stored' }
    ])
    const request = {
      drizzle,
      ...credsFor(USER_003, { currentRelationshipId: '' }),
      payload: { project: { name: NEW_PROJECT_NAME } }
    }

    await createProject.handler(request, {})

    expect(drizzle.insert().values.mock.calls[0][0]).toMatchObject({
      userId: USER_003,
      orgId: 'org-stored',
      relationshipId: 'rel-stored'
    })
  })

  test('Should stamp null org context when neither the token nor the store has one', async () => {
    const drizzle = createMockDrizzleInsert(newProject)
    const request = {
      drizzle,
      ...credsFor(USER_003),
      payload: { project: { name: NEW_PROJECT_NAME } }
    }

    await createProject.handler(request, {})

    const insertedValues = drizzle.insert().values.mock.calls[0][0]
    expect(insertedValues).toMatchObject({
      userId: USER_003,
      lastModifiedBy: USER_003,
      orgId: null,
      relationshipId: null
    })
  })
})

describe('#createProject validation', () => {
  const schema = createProject.options.validate.payload

  test('Should pass with a valid project and no userId in the body', async () => {
    const { error } = schema.validate({ project: { name: 'Test Project' } })
    expect(error).toBeUndefined()
  })

  test('Should reject a userId supplied in the body (identity comes from the token)', async () => {
    const { error } = schema.validate({
      project: { name: 'Test Project' },
      userId: USER_001
    })
    expect(error).toBeDefined()
    expect(error.message).toContain('"userId" is not allowed')
  })

  test('Should fail when project is missing', async () => {
    const { error } = schema.validate({})
    expect(error).toBeDefined()
    expect(error.message).toContain('"project" is required')
  })

  test('Should fail when project is not an object', async () => {
    const { error } = schema.validate({ project: 'not-an-object' })
    expect(error).toBeDefined()
    expect(error.message).toContain('"project" must be of type object')
  })
})

describe('#getProject', () => {
  test('Should return a single project by id', async () => {
    const drizzle = createMockDrizzle([mockProjects[0]])
    const request = {
      drizzle,
      ...credsFor(USER_001),
      params: { id: PROJECT_1_ID }
    }

    const result = await getProject.handler(request, {})

    expect(drizzle.select).toHaveBeenCalled()
    expect(drizzle._chain.where).toHaveBeenCalled()
    expect(result).toEqual({ ...mockProjects[0], projectId: PROJECT_1_ID })
  })

  test('Should throw 404 when project not found or not visible', async () => {
    const drizzle = createMockDrizzle([])
    const request = {
      drizzle,
      ...credsFor(USER_001),
      params: { id: UNKNOWN_PROJECT_ID }
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
      id: PROJECT_1_ID
    })
    expect(error).toBeUndefined()
  })

  test('Should fail when id param is not a UUID', async () => {
    const { error } = paramsSchema.validate({ id: 'not-a-uuid' })
    expect(error).toBeDefined()
    expect(error.message).toContain('"id" must be a valid GUID')
  })
})

describe('#getHabitat', () => {
  const HABITAT_1_ID = 'aa0e8400-e29b-41d4-a716-446655440001'
  const HABITAT_2_ID = 'aa0e8400-e29b-41d4-a716-446655440002'
  const UNKNOWN_HABITAT_ID = 'aa0e8400-e29b-41d4-a716-446655440099'

  const projectWithHabitats = {
    id: PROJECT_1_ID,
    project: {
      name: 'Project with habitats',
      baseline: {
        habitats: [
          {
            featureId: HABITAT_1_ID,
            ref: '1',
            type: 'Grassland - Modified grassland',
            broadType: 'Grassland',
            distinctiveness: 'Low',
            distinctivenessScore: 2,
            condition: 'Good',
            sizeSquareMetres: 12345
          },
          {
            featureId: HABITAT_2_ID,
            ref: '2',
            type: 'Cropland - Cereal crops',
            broadType: 'Cropland',
            distinctiveness: 'Low',
            distinctivenessScore: 2,
            sizeSquareMetres: 9876
          }
        ]
      }
    },
    userId: USER_001
  }

  // getHabitat now asks Postgres for the matching habitat rather than the whole
  // document, so the stub returns the row habitatByIdColumns yields.
  const habitatRow = (projectRow, featureId) => ({
    id: projectRow.id,
    habitat:
      projectRow.project?.baseline?.habitats?.find(
        (h) => h.featureId === featureId
      ) ?? null
  })

  test('Returns the matching habitat document', async () => {
    const drizzle = createMockDrizzle([
      habitatRow(projectWithHabitats, HABITAT_1_ID)
    ])
    const request = {
      drizzle,
      ...credsFor(USER_001),
      params: { projectId: PROJECT_1_ID, featureId: HABITAT_1_ID }
    }

    const result = await getHabitat.handler(request, {})

    expect(result.featureId).toBe(HABITAT_1_ID)
    expect(result.type).toBe('Grassland - Modified grassland')
  })

  test('Throws 404 when the project is not found or not visible', async () => {
    const drizzle = createMockDrizzle([])
    const request = {
      drizzle,
      ...credsFor(USER_001),
      params: { projectId: UNKNOWN_PROJECT_ID, featureId: HABITAT_1_ID }
    }
    await expect(getHabitat.handler(request, {})).rejects.toThrow(
      `Project ${UNKNOWN_PROJECT_ID} not found`
    )
  })

  test('Throws 404 when the project has no baseline yet', async () => {
    const drizzle = createMockDrizzle([
      habitatRow(
        { id: PROJECT_1_ID, project: { name: 'No baseline' } },
        HABITAT_1_ID
      )
    ])
    const request = {
      drizzle,
      ...credsFor(USER_001),
      params: { projectId: PROJECT_1_ID, featureId: HABITAT_1_ID }
    }
    await expect(getHabitat.handler(request, {})).rejects.toThrow(
      `Habitat ${HABITAT_1_ID} not found in project ${PROJECT_1_ID}`
    )
  })

  test('Throws 404 when the habitat featureId does not match', async () => {
    const drizzle = createMockDrizzle([
      habitatRow(projectWithHabitats, UNKNOWN_HABITAT_ID)
    ])
    const request = {
      drizzle,
      ...credsFor(USER_001),
      params: { projectId: PROJECT_1_ID, featureId: UNKNOWN_HABITAT_ID }
    }
    await expect(getHabitat.handler(request, {})).rejects.toThrow(
      `Habitat ${UNKNOWN_HABITAT_ID} not found in project ${PROJECT_1_ID}`
    )
  })
})

describe('#getHabitat validation', () => {
  const paramsSchema = getHabitat.options.validate.params

  test('Passes with two UUID params', () => {
    const { error } = paramsSchema.validate({
      projectId: PROJECT_1_ID,
      featureId: 'aa0e8400-e29b-41d4-a716-446655440001'
    })
    expect(error).toBeUndefined()
  })

  test('Fails when projectId is missing', () => {
    const { error } = paramsSchema.validate({
      featureId: 'aa0e8400-e29b-41d4-a716-446655440001'
    })
    expect(error).toBeDefined()
    expect(error.message).toContain('"projectId" is required')
  })

  test('Fails when featureId is not a UUID', () => {
    const { error } = paramsSchema.validate({
      projectId: PROJECT_1_ID,
      featureId: 'not-a-uuid'
    })
    expect(error).toBeDefined()
    expect(error.message).toContain('"featureId" must be a valid GUID')
  })
})

function createMockDrizzleUpdate(rows) {
  const returning = vi.fn().mockResolvedValue(rows)
  const where = vi.fn().mockReturnValue({ returning })
  const set = vi.fn().mockReturnValue({ where })

  return {
    update: vi.fn().mockReturnValue({ set }),
    _chain: { set, where, returning }
  }
}

describe('#updateProject', () => {
  test('Should be a PATCH route', async () => {
    expect(updateProject.method).toBe('PATCH')
    expect(updateProject.path).toBe('/projects/{id}')
  })

  test('Should update project name and return the updated project', async () => {
    const updatedProject = {
      ...mockProjects[0],
      project: {
        ...mockProjects[0].project,
        name: RENAMED_NAME
      }
    }
    const drizzle = createMockDrizzleUpdate([updatedProject])
    const request = {
      drizzle,
      ...credsFor(USER_001),
      params: { id: PROJECT_1_ID },
      payload: {
        project: { name: RENAMED_NAME }
      }
    }

    const result = await updateProject.handler(request, {})

    expect(drizzle.update).toHaveBeenCalled()
    expect(drizzle._chain.set).toHaveBeenCalledWith({
      project: expect.anything(),
      lastModifiedBy: USER_001
    })
    expect(drizzle._chain.where).toHaveBeenCalled()
    expect(result).toEqual({ ...updatedProject, projectId: PROJECT_1_ID })
  })

  test('Should throw 404 when project to update is not found or not visible', async () => {
    const drizzle = createMockDrizzleUpdate([])
    const request = {
      drizzle,
      ...credsFor(USER_001),
      params: { id: UNKNOWN_PROJECT_ID },
      payload: {
        project: { name: RENAMED_NAME }
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
      project: { name: RENAMED_NAME }
    })
    expect(error).toBeUndefined()
  })

  test('Should fail when name is missing', async () => {
    const { error } = payloadSchema.validate({
      project: {}
    })
    expect(error).toBeDefined()
    expect(error.message).toContain('"project.name" is required')
  })

  test('Should fail when name is empty', async () => {
    const { error } = payloadSchema.validate({
      project: { name: '' }
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
      id: PROJECT_1_ID
    })
    expect(error).toBeUndefined()
  })

  test('Should fail when id param is not a UUID', async () => {
    const { error } = paramsSchema.validate({ id: 'not-a-uuid' })
    expect(error).toBeDefined()
    expect(error.message).toContain('"id" must be a valid GUID')
  })
})
