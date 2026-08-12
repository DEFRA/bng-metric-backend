import { describe, it, expect, vi, beforeEach } from 'vitest'

import { HTTP_STATUS } from '../../common/helpers/http/status-codes.js'
import { ERROR_CODES } from '../../validation/geopackage/errors.js'
import {
  UPLOAD_ID,
  PROJECT_ID,
  CREDENTIALS,
  MOCK_FILENAME,
  MOCK_FILE_SIZE,
  STUB_LAYERS,
  makeH,
  makeDrizzle
} from '../../routes/validate-geopackage-route.test-fixtures.js'
import { saveUploadForProject } from './save-upload-for-project.js'
import { assignFeatureIds } from '../../validation/geopackage/assign-feature-ids.js'
import { refLookupKey } from '../../validation/geopackage/carry-forward-feature-ids.js'
import { calculateHabitatSizes } from './calculate-habitat-sizes.js'
import { extractHabitatData } from '../../validation/geopackage/baseline/extract-habitat-data.js'
import { extractPostIntervention } from '../../validation/geopackage/post-intervention/extract-post-intervention.js'
import { enrichBaselineDocumentWithUnits } from '../../utilities/enrichment/baseline/enrich-baseline-units.js'
import { enrichPostInterventionDocumentWithUnits } from '../../utilities/enrichment/post-intervention/enrich-post-intervention-units.js'
import {
  habitatDataSchema,
  postInterventionDataSchema
} from '../../validation/project.js'
import { persistUpload } from './persist-upload.js'

vi.mock('./calculate-habitat-sizes.js', () => ({
  calculateHabitatSizes: vi.fn()
}))

vi.mock('../../validation/geopackage/assign-feature-ids.js', () => ({
  assignFeatureIds: vi.fn((layers) => layers)
}))

vi.mock('../../validation/geopackage/baseline/extract-habitat-data.js', () => ({
  extractHabitatData: vi.fn()
}))

vi.mock(
  '../../validation/geopackage/post-intervention/extract-post-intervention.js',
  () => ({
    extractPostIntervention: vi
      .fn()
      .mockReturnValue({ document: {}, geometries: {} }),
    filterLostPostInterventionLayers: vi.fn((layers) => layers)
  })
)

vi.mock('../../utilities/enrichment/baseline/enrich-baseline-units.js', () => ({
  enrichBaselineDocumentWithUnits: vi.fn()
}))

vi.mock(
  '../../utilities/enrichment/post-intervention/enrich-post-intervention-units.js',
  () => ({
    enrichPostInterventionDocumentWithUnits: vi.fn()
  })
)

vi.mock('../../validation/project.js', () => ({
  habitatDataSchema: { validate: vi.fn() },
  postInterventionDataSchema: { validate: vi.fn() }
}))

vi.mock('./persist-upload.js', () => ({
  persistUpload: vi.fn().mockResolvedValue()
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

describe('saveUploadForProject', () => {
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
      saveUploadForProject(
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
    const result = await saveUploadForProject(
      deps,
      PROJECT_ID,
      STUB_LAYERS,
      {
        uploadId: UPLOAD_ID,
        credentials: CREDENTIALS,
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
    expect(persistUpload).toHaveBeenCalledWith(
      deps.drizzle,
      PROJECT_ID,
      { habitats: [] },
      { habitats: [] },
      expect.objectContaining({
        uploadId: UPLOAD_ID,
        credentials: CREDENTIALS,
        projectDocumentKey: 'baseline'
      })
    )
  })

  it('returns a 500 response when habitat sizing fails', async () => {
    calculateHabitatSizes.mockRejectedValue(new Error('PostGIS unavailable'))

    const result = await saveUploadForProject(
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
    expect(persistUpload).not.toHaveBeenCalled()
  })

  it('returns a validation error response when the document schema rejects the extract', async () => {
    habitatDataSchema.validate.mockReturnValue({
      error: { message: '"habitats[0].status" is required' }
    })

    const result = await saveUploadForProject(
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
    expect(persistUpload).not.toHaveBeenCalled()
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

    const result = await saveUploadForProject(
      deps,
      PROJECT_ID,
      STUB_LAYERS,
      {
        uploadId: UPLOAD_ID,
        credentials: CREDENTIALS,
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
    expect(persistUpload).toHaveBeenCalledWith(
      deps.drizzle,
      PROJECT_ID,
      { habitats: [] },
      { habitats: [] },
      expect.objectContaining({
        uploadId: UPLOAD_ID,
        credentials: CREDENTIALS,
        projectDocumentKey: 'postIntervention'
      })
    )
  })

  describe('featureId carry-forward', () => {
    const STORED_ID = '11111111-1111-4111-8111-111111111111'

    function drizzleReturning(project) {
      const { drizzle } = makeDrizzle()
      drizzle.select = vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve(project ? [{ project }] : []))
          }))
        }))
      }))
      return drizzle
    }

    async function save(project, config = BASELINE_CONFIG) {
      const drizzle = drizzleReturning(project)
      await saveUploadForProject(
        { drizzle, pgPool: {}, logger },
        PROJECT_ID,
        STUB_LAYERS,
        {
          uploadId: UPLOAD_ID,
          credentials: CREDENTIALS,
          filename: null,
          fileSize: null
        },
        h,
        config
      )
    }

    it('passes the stored ids for the document being replaced', async () => {
      await save({
        baseline: { habitats: [{ ref: 'PR-1', featureId: STORED_ID }] }
      })

      const [, featureIdByRef] = assignFeatureIds.mock.calls[0]
      expect(featureIdByRef.get(refLookupKey('habitats', 'PR-1'))).toBe(
        STORED_ID
      )
    })

    it('passes an empty map on a first import', async () => {
      await save(undefined)

      const [, featureIdByRef] = assignFeatureIds.mock.calls[0]
      expect(featureIdByRef.size).toBe(0)
    })

    // Uploading a post-intervention file must not inherit baseline ids: the two
    // documents are separate feature sets with their own rows downstream.
    it('scopes the lookup to the document key being written', async () => {
      await save(
        {
          baseline: { habitats: [{ ref: 'PR-1', featureId: STORED_ID }] },
          postIntervention: { habitats: [] }
        },
        POST_INTERVENTION_CONFIG
      )

      const [, featureIdByRef] = assignFeatureIds.mock.calls[0]
      expect(featureIdByRef.size).toBe(0)
    })

    it('reads the project once, serving both carry-forward and enrichment', async () => {
      const drizzle = drizzleReturning({
        baseline: { habitats: [], hedgerows: [], watercourses: [], units: {} },
        postIntervention: {}
      })

      await saveUploadForProject(
        { drizzle, pgPool: {}, logger },
        PROJECT_ID,
        STUB_LAYERS,
        {
          uploadId: UPLOAD_ID,
          credentials: CREDENTIALS,
          filename: null,
          fileSize: null
        },
        h,
        POST_INTERVENTION_CONFIG
      )

      expect(drizzle.select).toHaveBeenCalledTimes(1)
    })
  })
})
