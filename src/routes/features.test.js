import { describe, test, expect, vi } from 'vitest'

import { getFeature, findFeature } from './features.js'

const PROJECT_ID = '3f1e45b4-2e81-4c70-8a70-083ad958c913'
const HABITAT_ID = 'aa0e8400-e29b-41d4-a716-446655440001'
const HEDGEROW_ID = 'bb0e8400-e29b-41d4-a716-446655440002'
const WATERCOURSE_ID = 'cc0e8400-e29b-41d4-a716-446655440003'
const UNKNOWN_FEATURE_ID = 'dd0e8400-e29b-41d4-a716-446655440099'
const UNKNOWN_PROJECT_ID = 'a7dc53f2-05d2-4d75-9186-7e5cf52864bd'

const sampleHabitat = {
  featureId: HABITAT_ID,
  ref: '1',
  type: 'Grassland - Modified grassland'
}
const sampleHedgerow = {
  featureId: HEDGEROW_ID,
  ref: 'H1',
  type: 'Native hedgerow',
  sizeMetres: 100
}
const sampleWatercourse = {
  featureId: WATERCOURSE_ID,
  ref: 'W1',
  type: 'River',
  sizeMetres: 200
}

const projectWithBaseline = {
  id: PROJECT_ID,
  project: {
    baseline: {
      habitats: [sampleHabitat],
      hedgerows: [sampleHedgerow],
      watercourses: [sampleWatercourse]
    }
  }
}

function createMockDrizzle(rows) {
  const chain = {
    where: vi.fn().mockResolvedValue(rows)
  }
  chain.from = vi.fn().mockReturnValue({
    where: chain.where
  })
  return {
    select: vi.fn().mockReturnValue(chain)
  }
}

describe('#findFeature', () => {
  test('returns the habitat with type "habitat"', () => {
    const result = findFeature(projectWithBaseline.project.baseline, HABITAT_ID)
    expect(result).toEqual({ type: 'habitat', feature: sampleHabitat })
  })

  test('returns the hedgerow with type "hedgerow"', () => {
    const result = findFeature(
      projectWithBaseline.project.baseline,
      HEDGEROW_ID
    )
    expect(result).toEqual({ type: 'hedgerow', feature: sampleHedgerow })
  })

  test('returns the watercourse with type "watercourse"', () => {
    const result = findFeature(
      projectWithBaseline.project.baseline,
      WATERCOURSE_ID
    )
    expect(result).toEqual({ type: 'watercourse', feature: sampleWatercourse })
  })

  test('returns null when the featureId is absent from every layer', () => {
    expect(
      findFeature(projectWithBaseline.project.baseline, UNKNOWN_FEATURE_ID)
    ).toBeNull()
  })

  test('returns null when baseline is missing', () => {
    expect(findFeature(null, HABITAT_ID)).toBeNull()
    expect(findFeature(undefined, HABITAT_ID)).toBeNull()
  })

  test('tolerates missing layer arrays', () => {
    const baseline = { habitats: [sampleHabitat] }
    expect(findFeature(baseline, HEDGEROW_ID)).toBeNull()
    expect(findFeature(baseline, HABITAT_ID)).toEqual({
      type: 'habitat',
      feature: sampleHabitat
    })
  })

  test('throws when the same featureId appears in multiple layers', () => {
    const baseline = {
      habitats: [{ featureId: HABITAT_ID, ref: '1' }],
      hedgerows: [{ featureId: HABITAT_ID, ref: 'H1' }]
    }
    expect(() => findFeature(baseline, HABITAT_ID)).toThrow(
      /appears in multiple layers/
    )
  })
})

describe('#getFeature', () => {
  test('returns { type, feature } for a habitat', async () => {
    const drizzle = createMockDrizzle([projectWithBaseline])
    const request = {
      drizzle,
      params: { projectId: PROJECT_ID, featureId: HABITAT_ID }
    }
    const result = await getFeature.handler(request, {})
    expect(result).toEqual({ type: 'habitat', feature: sampleHabitat })
  })

  test('returns { type, feature } for a hedgerow', async () => {
    const drizzle = createMockDrizzle([projectWithBaseline])
    const request = {
      drizzle,
      params: { projectId: PROJECT_ID, featureId: HEDGEROW_ID }
    }
    const result = await getFeature.handler(request, {})
    expect(result).toEqual({ type: 'hedgerow', feature: sampleHedgerow })
  })

  test('throws 404 when the project is missing', async () => {
    const drizzle = createMockDrizzle([])
    const request = {
      drizzle,
      params: { projectId: UNKNOWN_PROJECT_ID, featureId: HABITAT_ID }
    }
    await expect(getFeature.handler(request, {})).rejects.toThrow(
      `Project ${UNKNOWN_PROJECT_ID} not found`
    )
  })

  test('throws 404 when the feature is absent from every layer', async () => {
    const drizzle = createMockDrizzle([projectWithBaseline])
    const request = {
      drizzle,
      params: { projectId: PROJECT_ID, featureId: UNKNOWN_FEATURE_ID }
    }
    await expect(getFeature.handler(request, {})).rejects.toThrow(
      `Feature ${UNKNOWN_FEATURE_ID} not found in project ${PROJECT_ID}`
    )
  })

  test('throws 404 when the project has no baseline', async () => {
    const drizzle = createMockDrizzle([
      { id: PROJECT_ID, project: { name: 'No baseline yet' } }
    ])
    const request = {
      drizzle,
      params: { projectId: PROJECT_ID, featureId: HABITAT_ID }
    }
    await expect(getFeature.handler(request, {})).rejects.toThrow(
      `Feature ${HABITAT_ID} not found in project ${PROJECT_ID}`
    )
  })
})

describe('#getFeature validation', () => {
  const paramsSchema = getFeature.options.validate.params

  test('passes with two UUID params', () => {
    const { error } = paramsSchema.validate({
      projectId: PROJECT_ID,
      featureId: HABITAT_ID
    })
    expect(error).toBeUndefined()
  })

  test('fails when projectId is not a UUID', () => {
    const { error } = paramsSchema.validate({
      projectId: 'not-a-uuid',
      featureId: HABITAT_ID
    })
    expect(error).toBeDefined()
  })

  test('fails when featureId is not a UUID', () => {
    const { error } = paramsSchema.validate({
      projectId: PROJECT_ID,
      featureId: 'not-a-uuid'
    })
    expect(error).toBeDefined()
  })
})
