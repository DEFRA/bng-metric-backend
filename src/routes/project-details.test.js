import { beforeEach, describe, test, expect, vi } from 'vitest'
import { auditProjectChange } from '../common/helpers/audit-project-change.js'
import { getProjectDetails, updateProjectDetails } from './project-details.js'

const PROJECT_ID = '3f1e45b4-2e81-4c70-8a70-083ad958c913'
const UNKNOWN_PROJECT_ID = 'a7dc53f2-05d2-4d75-9186-7e5cf52864bd'
const SUB = 'user-subject-123'

const sampleDetails = {
  localPlanningAuthority: 'South Downs National Park',
  surveyCompleters: 'Jane Smith',
  surveyCompletionDate: '01/06/2025',
  developmentType: 'Small site',
  nsips: 'No',
  applicant: 'Acme Developments Ltd'
}

function createMockDrizzleSelect(rows) {
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

function createMockDrizzle(updateRows = []) {
  const returning = vi.fn().mockResolvedValue(updateRows)
  const updateWhere = vi.fn().mockReturnValue({ returning })
  const set = vi.fn().mockReturnValue({ where: updateWhere })
  const update = vi.fn().mockReturnValue({ set })

  return { update, _set: set }
}

vi.mock('../common/helpers/audit-project-change.js', () => ({
  auditProjectChange: vi.fn()
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('#getProjectDetails', () => {
  test('returns details when project has them', async () => {
    const drizzle = createMockDrizzleSelect([
      { id: PROJECT_ID, project: { details: sampleDetails } }
    ])
    const result = await getProjectDetails.handler(
      {
        drizzle,
        params: { id: PROJECT_ID },
        auth: { credentials: { sub: SUB } }
      },
      {}
    )
    expect(result).toEqual(sampleDetails)
  })

  test('returns {} when project.details is null', async () => {
    const drizzle = createMockDrizzleSelect([
      { id: PROJECT_ID, project: { name: 'No details yet' } }
    ])
    const result = await getProjectDetails.handler(
      {
        drizzle,
        params: { id: PROJECT_ID },
        auth: { credentials: { sub: SUB } }
      },
      {}
    )
    expect(result).toEqual({})
  })

  test('returns {} when project is null', async () => {
    const drizzle = createMockDrizzleSelect([{ id: PROJECT_ID, project: null }])
    const result = await getProjectDetails.handler(
      {
        drizzle,
        params: { id: PROJECT_ID },
        auth: { credentials: { sub: SUB } }
      },
      {}
    )
    expect(result).toEqual({})
  })

  test('throws 404 when project not found', async () => {
    const drizzle = createMockDrizzleSelect([])
    await expect(
      getProjectDetails.handler(
        {
          drizzle,
          params: { id: UNKNOWN_PROJECT_ID },
          auth: { credentials: { sub: SUB } }
        },
        {}
      )
    ).rejects.toThrow(`Project ${UNKNOWN_PROJECT_ID} not found`)
  })
})

describe('#getProjectDetails validation', () => {
  const paramsSchema = getProjectDetails.options.validate.params

  test('passes with a UUID id param', () => {
    const { error } = paramsSchema.validate({ id: PROJECT_ID })
    expect(error).toBeUndefined()
  })

  test('fails when id is not a UUID', () => {
    const { error } = paramsSchema.validate({ id: 'not-a-uuid' })
    expect(error).toBeDefined()
    expect(error.message).toContain('"id" must be a valid GUID')
  })

  test('fails when id is missing', () => {
    const { error } = paramsSchema.validate({})
    expect(error).toBeDefined()
    expect(error.message).toContain('"id" is required')
  })
})

describe('#updateProjectDetails', () => {
  test('returns the persisted details including fields retained by the DB merge', async () => {
    const payload = { localPlanningAuthority: 'New LPA' }
    const persisted = { ...sampleDetails, localPlanningAuthority: 'New LPA' }
    const drizzle = createMockDrizzle([
      { id: PROJECT_ID, project: { details: persisted } }
    ])
    const result = await updateProjectDetails.handler(
      {
        drizzle,
        params: { id: PROJECT_ID },
        payload,
        auth: { credentials: { sub: SUB } }
      },
      {}
    )
    expect(drizzle.update).toHaveBeenCalled()
    expect(drizzle._set).toHaveBeenCalledWith({
      project: expect.anything(),
      lastModifiedBy: SUB
    })
    expect(result).toEqual(persisted)
    expect(result.developmentType).toBe(sampleDetails.developmentType)
    expect(auditProjectChange).toHaveBeenCalledOnce()
    expect(auditProjectChange).toHaveBeenCalledWith({
      actorId: SUB,
      projectId: PROJECT_ID,
      operation: 'updated',
      dataType: 'project.details'
    })
  })

  test('returns {} when project has no existing details', async () => {
    const drizzle = createMockDrizzle([
      { id: PROJECT_ID, project: { details: {} } }
    ])
    const result = await updateProjectDetails.handler(
      {
        drizzle,
        params: { id: PROJECT_ID },
        payload: {},
        auth: { credentials: { sub: SUB } }
      },
      {}
    )
    expect(result).toEqual({})
  })

  test('throws 404 when project not found or not visible', async () => {
    const drizzle = createMockDrizzle()
    await expect(
      updateProjectDetails.handler(
        {
          drizzle,
          params: { id: UNKNOWN_PROJECT_ID },
          payload: sampleDetails,
          auth: { credentials: { sub: SUB } }
        },
        {}
      )
    ).rejects.toThrow(`Project ${UNKNOWN_PROJECT_ID} not found`)
    expect(auditProjectChange).not.toHaveBeenCalled()
  })
})

describe('#updateProjectDetails validation', () => {
  const payloadSchema = updateProjectDetails.options.validate.payload
  const paramsSchema = updateProjectDetails.options.validate.params

  test('passes with a full valid payload', () => {
    const { error } = payloadSchema.validate(sampleDetails)
    expect(error).toBeUndefined()
  })

  test('passes with an empty object (all fields optional)', () => {
    const { error } = payloadSchema.validate({})
    expect(error).toBeUndefined()
  })

  test('fails when developmentType is not a valid enum value', () => {
    const { error } = payloadSchema.validate({
      developmentType: 'Massive site'
    })
    expect(error).toBeDefined()
    expect(error.message).toContain('"developmentType" must be one of')
  })

  test('fails when nsips is not a valid enum value', () => {
    const { error } = payloadSchema.validate({ nsips: 'Maybe' })
    expect(error).toBeDefined()
    expect(error.message).toContain('"nsips" must be one of')
  })

  test('fails when surveyCompletionDate is not in DD/MM/YYYY format', () => {
    const { error } = payloadSchema.validate({
      surveyCompletionDate: '2025-06-01'
    })
    expect(error).toBeDefined()
    expect(error.message).toContain('"surveyCompletionDate"')
  })

  test('accepts null surveyCompletionDate', () => {
    const { error } = payloadSchema.validate({ surveyCompletionDate: null })
    expect(error).toBeUndefined()
  })

  test('accepts empty string surveyCompletionDate', () => {
    const { error } = payloadSchema.validate({ surveyCompletionDate: '' })
    expect(error).toBeUndefined()
  })

  test('rejects a null payload', () => {
    const { error } = payloadSchema.validate(null)
    expect(error).toBeDefined()
  })

  test('fails when id param is not a UUID', () => {
    const { error } = paramsSchema.validate({ id: 'not-a-uuid' })
    expect(error).toBeDefined()
    expect(error.message).toContain('"id" must be a valid GUID')
  })
})
