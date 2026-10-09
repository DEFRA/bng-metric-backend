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
import {
  GEOMETRY_SIZE_FIELD,
  calculateHabitatSizes
} from './calculate-habitat-sizes.js'
import { extractHabitatData } from '../../validation/geopackage/baseline/extract-habitat-data.js'
import { extractPostIntervention } from '../../validation/geopackage/post-intervention/extract-post-intervention.js'
import { enrichBaselineDocumentWithUnits } from '../../utilities/enrichment/baseline/enrich-baseline-units.js'
import { enrichPostInterventionDocumentWithUnits } from '../../utilities/enrichment/post-intervention/enrich-post-intervention-units.js'
import {
  habitatDataSchema,
  postInterventionDataSchema
} from '../../validation/project.js'
import { persistCombinedUpload, persistUpload } from './persist-upload.js'

// Partial mock: `calculateHabitatSizes` is stubbed, but `attachGeometrySizes`
// is the real one, so the size-stamping the save path now does is exercised
// rather than replaced.
vi.mock('./calculate-habitat-sizes.js', async (importOriginal) => ({
  ...(await importOriginal()),
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
  persistUpload: vi.fn().mockResolvedValue(),
  persistCombinedUpload: vi.fn().mockResolvedValue()
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
    calculateHabitatSizes.mockReturnValue({ areaHabitats: {} })
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
    // Sizing is synchronous now — it reads measurements the validation worker
    // already made, and throws if any are missing rather than persisting a
    // document with half its habitats unsized.
    calculateHabitatSizes.mockImplementation(() => {
      throw new Error('did not measure areas feature a1')
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

  describe('a combined (baseline + post-intervention) file', () => {
    function row(ref, retention, baselineType) {
      return {
        properties: {
          'Parcel Ref': ref,
          'Retention Category': retention,
          'Baseline Habitat Type': baselineType
        }
      }
    }

    const COMBINED_LAYERS = {
      ...STUB_LAYERS,
      areas: [
        row('H1', 'Retained', 'Mixed scrub'),
        row('H2', 'Lost', 'Modified grassland'),
        row('H3', 'Created', 'N/A')
      ]
    }

    function refsOf(layers) {
      return layers.areas.map((feature) => feature.properties['Parcel Ref'])
    }

    async function saveCombined(layers, config) {
      return saveUploadForProject(
        deps,
        PROJECT_ID,
        layers,
        {
          uploadId: UPLOAD_ID,
          credentials: CREDENTIALS,
          filename: MOCK_FILENAME,
          fileSize: MOCK_FILE_SIZE
        },
        h,
        config
      )
    }

    it('AC5-AC7 derives the baseline and persists both documents together', async () => {
      const derivedBaseline = {
        habitats: [{ ref: 'H1' }, { ref: 'H2' }],
        hedgerows: [],
        watercourses: [{ ref: 'R1', sizeMetres: 1000 }],
        units: { habitatsTotal: 6 }
      }
      extractHabitatData.mockReturnValue({
        document: derivedBaseline,
        geometries: { habitats: ['baseline-geometry'] }
      })

      const result = await saveCombined(
        COMBINED_LAYERS,
        POST_INTERVENTION_CONFIG
      )

      expect(result).toBeNull()
      const [baselineLayers, baselineMeta] = extractHabitatData.mock.calls[0]
      expect(refsOf(baselineLayers)).toEqual(['H1', 'H2'])
      expect(baselineMeta).toMatchObject({ variant: 'baseline' })
      expect(enrichBaselineDocumentWithUnits).toHaveBeenCalledWith(
        derivedBaseline,
        logger,
        {}
      )
      expect(habitatDataSchema.validate).toHaveBeenCalledWith(
        derivedBaseline,
        expect.anything()
      )
      expect(extractPostIntervention).toHaveBeenCalledWith(
        COMBINED_LAYERS,
        expect.objectContaining({ uploadId: UPLOAD_ID })
      )
      expect(enrichPostInterventionDocumentWithUnits).toHaveBeenCalledWith(
        { habitats: [] },
        logger,
        expect.objectContaining({
          baselineLengthByRef: expect.any(Map),
          baselineUnits: derivedBaseline.units,
          baselineDocument: derivedBaseline
        })
      )
      expect(persistUpload).not.toHaveBeenCalled()
      expect(persistCombinedUpload).toHaveBeenCalledWith(
        deps.drizzle,
        PROJECT_ID,
        {
          baseline: expect.objectContaining({
            document: derivedBaseline,
            geometries: { habitats: ['baseline-geometry'] }
          }),
          postIntervention: expect.objectContaining({
            document: { habitats: [] },
            geometries: { habitats: [] }
          })
        },
        expect.objectContaining({
          uploadId: UPLOAD_ID,
          credentials: CREDENTIALS,
          uploadLabel: 'post-intervention'
        })
      )
    })

    it('sizes the derived baseline separately from the post-intervention rows', async () => {
      await saveCombined(COMBINED_LAYERS, POST_INTERVENTION_CONFIG)

      expect(calculateHabitatSizes).toHaveBeenCalledTimes(2)
      const sizedRefs = calculateHabitatSizes.mock.calls.map(([layers]) =>
        refsOf(layers)
      )
      expect(sizedRefs).toContainEqual(['H1', 'H2'])
      expect(sizedRefs).toContainEqual(['H1', 'H2', 'H3'])
    })

    it('rejects a post-intervention file that derives no baseline area habitats', async () => {
      extractHabitatData.mockImplementation((layers) => ({
        document: {
          habitats: (layers.areas ?? []).map((feature) => ({
            ref: feature.properties['Parcel Ref']
          }))
        },
        geometries: { habitats: [] }
      }))

      const result = await saveCombined(
        {
          ...STUB_LAYERS,
          areas: [row('H1', 'Retained', '  '), row('H2', 'Created', 'N/A')]
        },
        POST_INTERVENTION_CONFIG
      )

      expect(result).toBe(h)
      expect(h.response).toHaveBeenCalledWith({
        valid: false,
        errors: [
          expect.objectContaining({
            code: ERROR_CODES.NO_DERIVED_BASELINE_HABITATS
          })
        ]
      })
      expect(extractPostIntervention).not.toHaveBeenCalled()
      expect(persistCombinedUpload).not.toHaveBeenCalled()
      expect(persistUpload).not.toHaveBeenCalled()
    })

    it('rejects the upload without persisting when the derived baseline fails its schema', async () => {
      habitatDataSchema.validate.mockReturnValue({
        error: { message: '"habitats[0].status" is required' }
      })

      const result = await saveCombined(
        COMBINED_LAYERS,
        POST_INTERVENTION_CONFIG
      )

      expect(result).toBe(h)
      expect(extractPostIntervention).not.toHaveBeenCalled()
      expect(persistCombinedUpload).not.toHaveBeenCalled()
    })

    it('reuses the stored baseline id when a Created row shares the Lost row ref', async () => {
      const { assignFeatureIds: realAssignFeatureIds } = await vi.importActual(
        '../../validation/geopackage/assign-feature-ids.js'
      )
      assignFeatureIds.mockImplementation(realAssignFeatureIds)
      const storedId = '11111111-1111-4111-8111-111111111111'
      const sharedRefLayers = {
        areas: [
          row('H1', 'Lost', 'Modified grassland'),
          row('H1', 'Created', 'N/A')
        ]
      }
      const { drizzle } = makeDrizzle()
      drizzle.select = vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve([
                {
                  project: {
                    baseline: {
                      habitats: [{ ref: 'H1', featureId: storedId }]
                    }
                  }
                }
              ])
            )
          }))
        }))
      }))

      try {
        await saveUploadForProject(
          { drizzle, pgPool: {}, logger },
          PROJECT_ID,
          sharedRefLayers,
          {
            uploadId: UPLOAD_ID,
            credentials: CREDENTIALS,
            filename: MOCK_FILENAME,
            fileSize: MOCK_FILE_SIZE,
            geometrySizes: { areas: [{ idx: 0, value: 120 }] }
          },
          h,
          POST_INTERVENTION_CONFIG
        )
      } finally {
        assignFeatureIds.mockImplementation((layers) => layers)
      }

      const [baselineLayers] = extractHabitatData.mock.calls[0]
      expect(baselineLayers.areas).toHaveLength(1)
      expect(baselineLayers.areas[0].featureId).toBe(storedId)
      expect(baselineLayers.areas[0][GEOMETRY_SIZE_FIELD]).toBe(120)
    })

    it('keeps a placeholder baseline type when uploaded as a baseline', async () => {
      await saveCombined(
        {
          ...STUB_LAYERS,
          areas: [
            row('H1', undefined, 'N/A'),
            row('H2', 'Created', 'To be created')
          ]
        },
        BASELINE_CONFIG
      )

      const [baselineLayers] = extractHabitatData.mock.calls[0]
      expect(refsOf(baselineLayers)).toEqual(['H1'])
    })

    it('AC2-AC4 ignores the post-intervention rows when uploaded as a baseline', async () => {
      await saveCombined(COMBINED_LAYERS, BASELINE_CONFIG)

      const [baselineLayers] = extractHabitatData.mock.calls[0]
      expect(refsOf(baselineLayers)).toEqual(['H1', 'H2'])
      expect(extractPostIntervention).not.toHaveBeenCalled()
      expect(persistCombinedUpload).not.toHaveBeenCalled()
      expect(persistUpload).toHaveBeenCalledWith(
        deps.drizzle,
        PROJECT_ID,
        { habitats: [] },
        { habitats: [] },
        expect.objectContaining({ projectDocumentKey: 'baseline' })
      )
    })
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

    it('carries the stored baseline ids forward to the derived baseline', async () => {
      await save(
        {
          baseline: { habitats: [{ ref: 'PR-1', featureId: STORED_ID }] },
          postIntervention: { habitats: [] }
        },
        POST_INTERVENTION_CONFIG
      )

      const [, baselineIdByRef] = assignFeatureIds.mock.calls[1]
      expect(baselineIdByRef.get(refLookupKey('habitats', 'PR-1'))).toBe(
        STORED_ID
      )
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
