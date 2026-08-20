import { describe, expect, it, vi } from 'vitest'

import { ERROR_CODES } from '../errors.js'
import {
  materialiseIndexedAreas,
  validateGeoPackageLayersPostgis
} from './index.js'

// These two functions are the transaction plumbing around the PostGIS SQL:
// connect, BEGIN, materialise, check, COMMIT — or ROLLBACK and hand a poisoned
// connection to release(). Whether the SQL itself is *correct* is proven by
// integration-tests/postgis-validate-baseline-layers.test.js against a real
// postgis/postgis image; here the client is a stub, so the statement sequence
// and the failure branches can be asserted directly (including a failing
// ROLLBACK, which is impractical to provoke against a live database).

const BEGIN = 'BEGIN'
const COMMIT = 'COMMIT'
const ROLLBACK = 'ROLLBACK'

// Tags for the three generated statements, so assertions read as a
// transaction script rather than as SQL substring matching.
const MATERIALISE = 'materialise'
const INDEX = 'index'
const CHECK = 'check'

const AREAS_LAYER = 'areas'
const REDLINE_LAYER = 'redline'
const BNG_SRID = 27700
const OVERSIZE_AREA_SQ_M = 121_000_000

// $1..$5 are the parallel feature arrays; CHECK_QUERY appends the England
// reference geometry as $6.
const FEATURE_PARAM_COUNT = 5

function tagFor(sql) {
  if (sql === BEGIN || sql === COMMIT || sql === ROLLBACK) {
    return sql
  }
  if (sql.includes('CREATE TEMP TABLE')) {
    return MATERIALISE
  }
  if (sql.includes('CREATE INDEX')) {
    return INDEX
  }
  return CHECK
}

/**
 * Stub `pg` client that records every statement it is handed.
 *
 * @param {object} [options]
 * @param {object[]} [options.rows] Rows the check query resolves with
 * @param {string} [options.failTag] Tag of the statement that should reject
 * @param {Error} [options.rollbackError] Makes the ROLLBACK itself reject
 */
function createClient({ rows = [], failTag, rollbackError } = {}) {
  const statements = []
  const client = {
    query: vi.fn((sql, params) => {
      const tag = tagFor(sql)
      statements.push({ tag, params })
      if (tag === ROLLBACK && rollbackError) {
        return Promise.reject(rollbackError)
      }
      if (tag === failTag) {
        return Promise.reject(new Error(`stub failure on ${tag}`))
      }
      return Promise.resolve({ rows })
    }),
    release: vi.fn()
  }
  return { client, statements }
}

function createPool(options) {
  const { client, statements } = createClient(options)
  const pool = { connect: vi.fn(() => Promise.resolve(client)) }
  return { pool, client, statements }
}

function statementFor(statements, tag) {
  return statements.find((statement) => statement.tag === tag)
}

function tagsOf(statements) {
  return statements.map((statement) => statement.tag)
}

function feature(overrides = {}) {
  return {
    properties: { habitat: 'Grassland' },
    nativeGeometry: { type: 'Polygon', coordinates: [] },
    nativeSrid: BNG_SRID,
    ...overrides
  }
}

describe('materialiseIndexedAreas', () => {
  it('creates the temp table, then indexes it', async () => {
    const { client, statements } = createClient()

    await materialiseIndexedAreas(client, { areas: [feature()] })

    expect(tagsOf(statements)).toEqual([MATERIALISE, INDEX])
    expect(statementFor(statements, INDEX).params).toBeUndefined()
  })

  it('passes the features as five parallel arrays and returns them', async () => {
    const { client, statements } = createClient()

    const arrays = await materialiseIndexedAreas(client, {
      redline: [feature()],
      areas: [feature(), feature()]
    })

    expect(arrays.layerNames).toEqual([REDLINE_LAYER, AREAS_LAYER, AREAS_LAYER])
    expect(arrays.idxs).toEqual([0, 0, 1])
    expect(arrays.srids).toEqual([BNG_SRID, BNG_SRID, BNG_SRID])
    expect(statementFor(statements, MATERIALISE).params).toEqual([
      arrays.layerNames,
      arrays.idxs,
      arrays.props,
      arrays.geoms,
      arrays.srids
    ])
  })

  it('skips features with no native geometry, keeping the source index', async () => {
    const { client } = createClient()

    const arrays = await materialiseIndexedAreas(client, {
      areas: [feature({ nativeGeometry: undefined }), feature()]
    })

    expect(arrays.layerNames).toEqual([AREAS_LAYER])
    expect(arrays.idxs).toEqual([1])
  })

  it('serialises missing properties as an empty object', async () => {
    const { client } = createClient()

    const arrays = await materialiseIndexedAreas(client, {
      areas: [feature({ properties: undefined })]
    })

    expect(arrays.props).toEqual(['{}'])
  })
})

describe('validateGeoPackageLayersPostgis', () => {
  it('runs the whole check inside one committed transaction', async () => {
    const { pool, client, statements } = createPool()

    const result = await validateGeoPackageLayersPostgis(pool, {
      areas: [feature()]
    })

    expect(tagsOf(statements)).toEqual([
      BEGIN,
      MATERIALISE,
      INDEX,
      CHECK,
      COMMIT
    ])
    expect(result).toEqual({ valid: true, errors: [] })
    expect(client.release).toHaveBeenCalledTimes(1)
    expect(client.release).toHaveBeenCalledWith(undefined)
  })

  it('reuses the materialised arrays for the check query, plus England', async () => {
    const { pool, statements } = createPool()

    await validateGeoPackageLayersPostgis(pool, { areas: [feature()] })

    const checkParams = statementFor(statements, CHECK).params
    expect(checkParams.slice(0, FEATURE_PARAM_COUNT)).toEqual(
      statementFor(statements, MATERIALISE).params
    )
    expect(JSON.parse(checkParams[FEATURE_PARAM_COUNT])).toHaveProperty('type')
  })

  it('orders errors by ERROR_ORDER, not by the order rows come back', async () => {
    const { pool } = createPool({
      rows: [
        {
          code: ERROR_CODES.REDLINE_AREA_TOO_LARGE,
          payload: { total: OVERSIZE_AREA_SQ_M }
        },
        { code: ERROR_CODES.NO_REDLINE }
      ]
    })

    const result = await validateGeoPackageLayersPostgis(pool, {})

    expect(result.valid).toBe(false)
    expect(result.errors.map((error) => error.code)).toEqual([
      ERROR_CODES.NO_REDLINE,
      ERROR_CODES.REDLINE_AREA_TOO_LARGE
    ])
  })

  it('ignores rows whose code has no builder', async () => {
    const { pool } = createPool({ rows: [{ code: 'NOT_A_REAL_CODE' }] })

    const result = await validateGeoPackageLayersPostgis(pool, {})

    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('rolls back and rethrows when the check query fails', async () => {
    const { pool, client, statements } = createPool({ failTag: CHECK })

    await expect(
      validateGeoPackageLayersPostgis(pool, { areas: [feature()] })
    ).rejects.toThrow(`stub failure on ${CHECK}`)

    expect(tagsOf(statements)).toEqual([
      BEGIN,
      MATERIALISE,
      INDEX,
      CHECK,
      ROLLBACK
    ])
    expect(client.release).toHaveBeenCalledWith(undefined)
  })

  it('rolls back when the materialise step is what fails', async () => {
    const { pool, client, statements } = createPool({ failTag: MATERIALISE })

    await expect(
      validateGeoPackageLayersPostgis(pool, { areas: [feature()] })
    ).rejects.toThrow(`stub failure on ${MATERIALISE}`)

    expect(tagsOf(statements)).toEqual([BEGIN, MATERIALISE, ROLLBACK])
    expect(client.release).toHaveBeenCalledWith(undefined)
  })

  it('destroys the client when the rollback itself fails', async () => {
    const rollbackError = new Error('rollback failed')
    const { pool, client } = createPool({
      failTag: CHECK,
      rollbackError
    })

    // The original failure is what the caller sees; the rollback error only
    // decides whether the connection is safe to hand back to the pool.
    await expect(
      validateGeoPackageLayersPostgis(pool, { areas: [feature()] })
    ).rejects.toThrow(`stub failure on ${CHECK}`)

    expect(client.release).toHaveBeenCalledWith(rollbackError)
  })
})
