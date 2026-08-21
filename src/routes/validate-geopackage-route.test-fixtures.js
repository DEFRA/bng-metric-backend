import { vi } from 'vitest'

const UPLOAD_ID = 'f6b667d8-998f-4f55-8a20-204c0c289147'
const PROJECT_ID = '3f1e45b4-2e81-4c70-8a70-083ad958c913'
const SUB = 'defra-id-sub-abc123'
const RELATIONSHIP_ID = 'rel-abc123'
// Verified-token claims as the routes hand them to visibleToUser: the `sub`
// alone is no longer enough — the org context comes from the same payload.
const CREDENTIALS = {
  sub: SUB,
  currentRelationshipId: RELATIONSHIP_ID,
  relationships: [`${RELATIONSHIP_ID}:org-abc:Acme Ltd:0:Employee:1`],
  roles: [`${RELATIONSHIP_ID}:bng completer:3`]
}
const FEATURE_ID_RED = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const FEATURE_ID_HAB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const FEATURE_ID_HEDGE = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const FEATURE_ID_WATER = 'dddddddd-dddd-dddd-dddd-dddddddddddd'

const MOCK_BUCKET = 'baseline-files'
const MOCK_KEY = 'baseline/file.gpkg'
const MOCK_FILENAME = 'my-baseline.gpkg'
const MOCK_FILE_SIZE = 204800
const MOCK_DOWNLOAD_PATH = '/tmp/s3-download-test/download.bin'
const THROWS_502 = 'throws a 502 Bad Gateway'

const HTTP_404 = 404
const HTTP_409 = 409
const HTTP_422 = 422
const HTTP_502 = 502
const HTTP_504 = 504
const HTTP_413 = 413

const BNG_SRID = 27700

const STUB_AREA_HABITAT_TYPE = 'Lowland meadows'
const STUB_HEDGEROW_TYPE = 'Species-rich native hedgerow'
const STUB_RIPARIAN_ENCROACHMENT = 'No Encroachment/No Encroachment'
const STUB_WATERCOURSE_ENCROACHMENT = 'No Encroachment'

const STUB_LAYERS = {
  redline: [],
  areas: [],
  hedgerows: [],
  watercourses: [],
  iggis: [],
  trees: [],
  missingLayers: []
}

const SAMPLE_GEOM = { type: 'Polygon', coordinates: [[[0, 0]]] }
const SAMPLE_LINE = { type: 'LineString', coordinates: [[0, 0]] }

const STUB_EXTRACTED = {
  document: {
    uploadId: UPLOAD_ID,
    importedAt: '2026-05-08T00:00:00.000Z',
    redLine: { featureId: FEATURE_ID_RED, properties: {} },
    habitats: [
      {
        featureId: FEATURE_ID_HAB,
        ref: 'P1',
        type: STUB_AREA_HABITAT_TYPE,
        broadType: 'Grassland',
        condition: 'Good',
        status: 'Complete',
        sizeSquareMetres: 10
      }
    ],
    hedgerows: [
      {
        featureId: FEATURE_ID_HEDGE,
        ref: 'H1',
        type: STUB_HEDGEROW_TYPE,
        condition: 'Good',
        status: 'Complete',
        sizeMetres: 20
      }
    ],
    watercourses: [
      {
        featureId: FEATURE_ID_WATER,
        ref: 'W1',
        type: 'Ditches',
        condition: 'Moderate',
        riparianEncroachment: STUB_RIPARIAN_ENCROACHMENT,
        watercourseEncroachment: STUB_WATERCOURSE_ENCROACHMENT,
        status: 'Complete',
        sizeMetres: 30
      }
    ],
    habitatSizes: {
      areaHabitats: { totalSquareMetres: 10 },
      hedgerows: { totalMetres: 20 },
      watercourses: { totalMetres: 30 }
    }
  },
  geometries: {
    redLine: {
      featureId: FEATURE_ID_RED,
      geometry: SAMPLE_GEOM,
      srid: BNG_SRID
    },
    habitats: [
      {
        featureId: FEATURE_ID_HAB,
        ref: 'P1',
        geometry: SAMPLE_GEOM,
        srid: BNG_SRID
      }
    ],
    hedgerows: [
      {
        featureId: FEATURE_ID_HEDGE,
        ref: 'H1',
        geometry: SAMPLE_LINE,
        srid: BNG_SRID
      }
    ],
    watercourses: [
      {
        featureId: FEATURE_ID_WATER,
        ref: 'W1',
        geometry: SAMPLE_LINE,
        srid: BNG_SRID
      }
    ]
  }
}

const STUB_POST_INTERVENTION_EXTRACTED = {
  document: {
    uploadId: UPLOAD_ID,
    importedAt: '2026-05-08T00:00:00.000Z',
    redLine: { featureId: FEATURE_ID_RED, properties: {} },
    habitats: [
      {
        featureId: FEATURE_ID_HAB,
        ref: 'P1',
        retentionCategory: 'Retained',
        area: 10,
        sizeSquareMetres: 10,
        units: null,
        status: 'Complete',
        baseline: {
          type: STUB_AREA_HABITAT_TYPE,
          broadType: 'Grassland',
          condition: 'Good'
        },
        proposed: {
          type: STUB_AREA_HABITAT_TYPE,
          broadType: 'Grassland',
          condition: 'Good'
        },
        properties: {}
      }
    ],
    hedgerows: [
      {
        featureId: FEATURE_ID_HEDGE,
        ref: 'H1',
        retentionCategory: 'Retained',
        length: 20,
        sizeMetres: 20,
        units: null,
        status: 'Complete',
        baseline: {
          type: STUB_HEDGEROW_TYPE,
          condition: 'Good'
        },
        proposed: {
          type: STUB_HEDGEROW_TYPE,
          condition: 'Good'
        },
        properties: {}
      }
    ],
    watercourses: [
      {
        featureId: FEATURE_ID_WATER,
        ref: 'W1',
        retentionCategory: 'Retained',
        length: 30,
        sizeMetres: 30,
        units: null,
        status: 'Complete',
        baseline: {
          type: 'Ditches',
          condition: 'Moderate',
          riparianEncroachment: STUB_RIPARIAN_ENCROACHMENT,
          watercourseEncroachment: STUB_WATERCOURSE_ENCROACHMENT
        },
        proposed: {
          type: 'Ditches',
          condition: 'Moderate',
          riparianEncroachment: STUB_RIPARIAN_ENCROACHMENT,
          watercourseEncroachment: STUB_WATERCOURSE_ENCROACHMENT
        },
        properties: {}
      }
    ],
    habitatSizes: {
      areaHabitats: { totalSquareMetres: 10 },
      hedgerows: { totalMetres: 20 },
      watercourses: { totalMetres: 30 }
    }
  },
  geometries: STUB_EXTRACTED.geometries
}

function makeH() {
  return {
    response: vi.fn().mockReturnThis(),
    code: vi.fn().mockReturnThis()
  }
}

// Simple .select().from().where().limit() chain (no .for()) used by queries
// that run outside a transaction. Always resolves to an empty array.
function simpleSelectChain() {
  const limitStep = { limit: () => Promise.resolve([]) }
  const whereStep = { where: () => limitStep }
  return { from: () => whereStep }
}

// Drizzle's .select().from().where().for().limit() chain. Built bottom-up so
// each step is a single-level arrow rather than nested inline, keeping the
// arrows under S2004's 4-deep limit. The .for('update') step (paired with
// SET LOCAL lock_timeout) is what serialises concurrent re-uploads for the
// same project — the mock no-ops every step and returns `rows`, unless
// `lockError` is set, in which case `.limit()` rejects with that error
// (simulates the 55P03 the driver would raise after lock_timeout fires).
function projectLookupChain(rows, lockError, onWhere) {
  const result = lockError ? Promise.reject(lockError) : Promise.resolve(rows)
  const limitStep = { limit: () => result }
  const forStep = { for: () => limitStep }
  const whereStep = {
    where: (condition) => {
      onWhere?.(condition)
      return forStep
    }
  }
  return { from: () => whereStep }
}

/**
 * Build a drizzle test double whose .transaction(cb) calls cb with a tx object
 * that records every chained call. The tx supports the four DSL paths the route
 * uses (select/delete/update) plus tx.execute(...) for the raw INSERT SQL.
 *
 * `projectExists` controls whether the initial project SELECT returns a row;
 * setting it to false drives the 404 path.
 */
function makeDrizzle({ projectExists = true, lockError = null } = {}) {
  const log = {
    transactionCalls: 0,
    selectCalls: 0,
    deletes: [],
    executes: [],
    updates: [],
    // The condition passed to the project-lock SELECT .where(...) — lets tests
    // assert the write is scoped to a project visible to the requesting user.
    projectWhere: []
  }

  const tx = {
    select: vi.fn(() => {
      log.selectCalls += 1
      return projectLookupChain(
        projectExists ? [{ id: PROJECT_ID }] : [],
        lockError,
        (condition) => log.projectWhere.push(condition)
      )
    }),
    delete: vi.fn((table) => ({
      where: vi.fn(() => {
        log.deletes.push(table)
        return Promise.resolve()
      })
    })),
    execute: vi.fn((sqlChunk) => {
      log.executes.push(sqlChunk)
      return Promise.resolve()
    }),
    update: vi.fn((table) => ({
      set: vi.fn((payload) => ({
        where: vi.fn(() => {
          log.updates.push({ table, payload })
          return Promise.resolve()
        })
      }))
    }))
  }

  // A simple no-.for() chain used by fetchBaselineWatercourseLengthByRef, which
  // queries the project outside of a transaction. Resolves to an empty array so
  // the baseline watercourse map is empty by default.
  const drizzle = {
    select: vi.fn(() => simpleSelectChain()),
    transaction: vi.fn(async (cb) => {
      log.transactionCalls += 1
      return cb(tx)
    })
  }

  return { drizzle, tx, log }
}

/**
 * What downloadFileToTemp hands back: a temp file on disk plus the cleanup the
 * route is obliged to call (BMD-913).
 */
function makeDownload(path = MOCK_DOWNLOAD_PATH) {
  return { path, size: MOCK_FILE_SIZE, cleanup: vi.fn().mockResolvedValue() }
}

export {
  UPLOAD_ID,
  PROJECT_ID,
  SUB,
  RELATIONSHIP_ID,
  CREDENTIALS,
  FEATURE_ID_RED,
  FEATURE_ID_HAB,
  FEATURE_ID_HEDGE,
  FEATURE_ID_WATER,
  MOCK_BUCKET,
  MOCK_KEY,
  MOCK_FILENAME,
  MOCK_FILE_SIZE,
  MOCK_DOWNLOAD_PATH,
  makeDownload,
  THROWS_502,
  HTTP_404,
  HTTP_409,
  HTTP_422,
  HTTP_502,
  HTTP_504,
  HTTP_413,
  STUB_LAYERS,
  STUB_EXTRACTED,
  STUB_POST_INTERVENTION_EXTRACTED,
  SAMPLE_GEOM,
  SAMPLE_LINE,
  makeH,
  makeDrizzle
}
