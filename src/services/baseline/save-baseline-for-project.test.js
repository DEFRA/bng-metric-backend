import { describe, it, expect, vi, beforeEach } from 'vitest'

import { HTTP_STATUS } from '../../common/helpers/http/status-codes.js'
import { ERROR_CODES } from '../../validation/baseline/errors.js'
import {
  UPLOAD_ID,
  PROJECT_ID,
  SUB,
  MOCK_FILENAME,
  MOCK_FILE_SIZE,
  STUB_LAYERS,
  makeH,
  makeDrizzle
} from '../../routes/baseline.test-fixtures.js'
import { saveBaselineForProject } from './save-baseline-for-project.js'
import { calculateHabitatSizes } from './calculate-habitat-sizes.js'
import { extractHabitatData } from '../../validation/baseline/extract-habitat-data.js'
import { extractPostIntervention } from '../../validation/baseline/extract-post-intervention.js'
import { enrichBaselineDocumentWithUnits } from '../../utilities/baseline/enrich-baseline-units.js'
import { enrichPostInterventionDocumentWithUnits } from '../../utilities/baseline/enrich-post-intervention-units.js'
import { reEnrichStoredPostInterventionIfPresent } from '../../utilities/baseline/re-enrich-stored-post-intervention.js'
import {
  habitatDataSchema,
  postInterventionDataSchema
} from '../../validation/project.js'
import { persistBaseline } from './persist-baseline.js'

vi.mock('./calculate-habitat-sizes.js', () => ({
  calculateHabitatSizes: vi.fn()
}))

vi.mock('../../validation/baseline/assign-feature-ids.js', () => ({
  assignFeatureIds: vi.fn((layers) => layers)
}))

vi.mock('../../validation/baseline/extract-habitat-data.js', () => ({
  extractHabitatData: vi.fn()
}))

vi.mock('../../validation/baseline/extract-post-intervention.js', () => ({
  extractPostIntervention: vi
    .fn()
    .mockReturnValue({ document: {}, geometries: {} }),
  filterLostLinearPostInterventionLayers: vi.fn((layers) => layers)
}))

vi.mock('../../utilities/baseline/enrich-baseline-units.js', () => ({
  enrichBaselineDocumentWithUnits: vi.fn()
}))

vi.mock('../../utilities/baseline/enrich-post-intervention-units.js', () => ({
  enrichPostInterventionDocumentWithUnits: vi.fn()
}))

vi.mock(
  '../../utilities/baseline/re-enrich-stored-post-intervention.js',
  () => ({
    reEnrichStoredPostInterventionIfPresent: vi
      .fn()
      .mockResolvedValue(undefined)
  })
)

vi.mock('../../validation/project.js', () => ({
  habitatDataSchema: { validate: vi.fn() },
  postInterventionDataSchema: { validate: vi.fn() }
}))

vi.mock('./persist-baseline.js', () => ({
  persistBaseline: vi.fn().mockResolvedValue()
}))

const BASELINE_CONFIG = {
  projectDocumentKey: 'baseline',
  routeName: 'validateBaseline',
  uploadLabel: 'baseline'
}

const POST_INTERVENTION_CONFIG = {
  projectDocumentKey: 'postIntervention',
  routeName: 'validatePostIntervention',
  uploadLabel: 'post-intervention'
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

describe('saveBaselineForProject', () => {
  let logger
  let h
  let deps

  beforeEach(() => {
    vi.clearAllMocks()
    logger = makeLogger()
    h = makeH()
    const { drizzle } = makeDrizzle()
    deps = { drizzle, pgPool: {}, logger }
    calculateHabitatSizes.mockResolvedValue({ areaHabitats: {} })
    extractHabitatData.mockReturnValue({
      document: { habitats: [] },
      geometries: { habitats: [] }
    })
    habitatDataSchema.validate.mockReturnValue({ error: null })
    postInterventionDataSchema.validate.mockReturnValue({ error: null })
    extractPostIntervention.mockReturnValue({
      document: { habitats: [] },
      geometries: { habitats: [] }
    })
  })

  it('throws when config.projectDocumentKey is not recognised', async () => {
    await expect(
      saveBaselineForProject(
        deps,
        PROJECT_ID,
        STUB_LAYERS,
        { uploadId: UPLOAD_ID, filename: null, fileSize: null },
        h,
        { ...BASELINE_CONFIG, projectDocumentKey: 'unknown' }
      )
    ).rejects.toThrow('Unsupported projectDocumentKey: unknown')
  })

  it('returns null after a successful extract, enrich, validate and persist', async () => {
    const result = await saveBaselineForProject(
      deps,
      PROJECT_ID,
      STUB_LAYERS,
      {
        uploadId: UPLOAD_ID,
        sub: SUB,
        filename: MOCK_FILENAME,
        fileSize: MOCK_FILE_SIZE
      },
      h,
      BASELINE_CONFIG
    )

    expect(result).toBeNull()
    expect(calculateHabitatSizes).toHaveBeenCalled()
    expect(extractHabitatData).toHaveBeenCalledWith(
      STUB_LAYERS,
      expect.objectContaining({ variant: 'baseline' })
    )
    expect(enrichBaselineDocumentWithUnits).toHaveBeenCalled()
    expect(persistBaseline).toHaveBeenCalledWith(
      deps.drizzle,
      PROJECT_ID,
      { habitats: [] },
      { habitats: [] },
      expect.objectContaining({
        uploadId: UPLOAD_ID,
        sub: SUB,
        projectDocumentKey: 'baseline'
      })
    )
    expect(reEnrichStoredPostInterventionIfPresent).toHaveBeenCalledWith(
      deps.drizzle,
      PROJECT_ID,
      logger
    )
  })

  it('returns a 500 response when habitat sizing fails', async () => {
    calculateHabitatSizes.mockRejectedValue(new Error('PostGIS unavailable'))

    const result = await saveBaselineForProject(
      deps,
      PROJECT_ID,
      STUB_LAYERS,
      { uploadId: UPLOAD_ID, filename: null, fileSize: null },
      h,
      BASELINE_CONFIG
    )

    expect(h.response).toHaveBeenCalledWith({
      valid: false,
      errors: [expect.objectContaining({ code: ERROR_CODES.SIZING_FAILED })]
    })
    expect(h.code).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    expect(result).toBe(h)
    expect(logger.error).toHaveBeenCalled()
    expect(persistBaseline).not.toHaveBeenCalled()
  })

  it('returns a validation error response when the document schema rejects the extract', async () => {
    habitatDataSchema.validate.mockReturnValue({
      error: { message: '"habitats[0].status" is required' }
    })

    const result = await saveBaselineForProject(
      deps,
      PROJECT_ID,
      STUB_LAYERS,
      { uploadId: UPLOAD_ID, filename: null, fileSize: null },
      h,
      BASELINE_CONFIG
    )

    expect(h.response).toHaveBeenCalledWith({
      valid: false,
      errors: [
        expect.objectContaining({
          code: ERROR_CODES.INVALID_FILE_METADATA,
          message: '"habitats[0].status" is required'
        })
      ]
    })
    expect(result).toBe(h)
    expect(logger.info).toHaveBeenCalled()
    expect(persistBaseline).not.toHaveBeenCalled()
  })

  it('returns null after a successful post-intervention extract, enrich, validate and persist', async () => {
    const baselineUnits = {
      habitatsTotal: 6,
      treesTotal: 2,
      hedgerowsTotal: 4,
      watercoursesTotal: 3
    }
    const baselineWatercourses = [{ ref: 'R1', sizeMetres: 1000 }]
    const { drizzle } = makeDrizzle()
    drizzle.select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() =>
            Promise.resolve([
              {
                project: {
                  baseline: {
                    watercourses: baselineWatercourses,
                    hedgerows: [],
                    units: baselineUnits
                  }
                }
              }
            ])
          )
        }))
      }))
    }))
    deps = { drizzle, pgPool: {}, logger }

    const result = await saveBaselineForProject(
      deps,
      PROJECT_ID,
      STUB_LAYERS,
      {
        uploadId: UPLOAD_ID,
        sub: SUB,
        filename: MOCK_FILENAME,
        fileSize: MOCK_FILE_SIZE
      },
      h,
      POST_INTERVENTION_CONFIG
    )

    expect(result).toBeNull()
    expect(extractPostIntervention).toHaveBeenCalledWith(
      STUB_LAYERS,
      expect.objectContaining({ uploadId: UPLOAD_ID })
    )
    expect(enrichPostInterventionDocumentWithUnits).toHaveBeenCalledWith(
      { habitats: [] },
      logger,
      expect.objectContaining({
        baselineLengthByRef: expect.any(Map),
        baselineUnits
      })
    )
    expect(persistBaseline).toHaveBeenCalledWith(
      deps.drizzle,
      PROJECT_ID,
      { habitats: [] },
      { habitats: [] },
      expect.objectContaining({
        uploadId: UPLOAD_ID,
        sub: SUB,
        projectDocumentKey: 'postIntervention'
      })
    )
  })
})
