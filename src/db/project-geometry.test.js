import { describe, expect, test, vi } from 'vitest'

import { readProjectGeometry } from './project-geometry.js'

/**
 * A drizzle stand-in that answers each `.from(table)` with whatever rows the
 * test has queued for it. Reading five tables per call is exactly the point of
 * this module, so the fake is keyed by table rather than by call order.
 *
 * `limit` is honoured rather than ignored, because the per-layer cap is
 * enforced in SQL: a fake that returned everything regardless would let a
 * broken `.limit()` pass its own test.
 */
function createMockDrizzle(rowsByTable) {
  const tables = []
  const limits = []

  const select = vi.fn(() => ({
    from: vi.fn((table) => {
      tables.push(table)
      const rows = rowsByTable.get(table) ?? []
      const limit = vi.fn((count) => {
        limits.push({ table, count })
        return Promise.resolve(rows.slice(0, count))
      })
      const terminal = {
        orderBy: vi.fn().mockReturnValue({ limit }),
        limit
      }
      return { where: vi.fn().mockReturnValue(terminal) }
    })
  }))

  return { drizzle: { select }, tables, limits }
}

const POINT = { type: 'MultiPoint', coordinates: [[412000, 287000]] }
const POLYGON = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [412000, 287000],
        [412100, 287000],
        [412100, 287100],
        [412000, 287000]
      ]
    ]
  ]
}

function rowsFor(tables, entries) {
  const map = new Map()
  for (const [name, rows] of entries) {
    map.set(tables[name], rows)
  }
  return map
}

async function baselineTables() {
  const schema = await import('./schema/index.js')
  return {
    redLine: schema.baselineRedLine,
    habitats: schema.baselineHabitats,
    hedgerows: schema.baselineHedgerows,
    watercourses: schema.baselineWatercourses,
    trees: schema.baselineTrees
  }
}

async function readWith(entries, options) {
  const tables = await baselineTables()
  const { drizzle } = createMockDrizzle(rowsFor(tables, entries))
  return readProjectGeometry(drizzle, 'project-1', 'baseline', options)
}

/** `count` geometry rows, ids in order, all the same shape. */
function habitatRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    featureId: `f${index}`,
    geoJson: JSON.stringify(POLYGON)
  }))
}

describe('#readProjectGeometry', () => {
  test('returns each layer as parsed GeoJSON keyed by featureId', async () => {
    const geometry = await readWith([
      ['habitats', [{ featureId: 'f1', geoJson: JSON.stringify(POLYGON) }]],
      ['trees', [{ featureId: 'f2', geoJson: JSON.stringify(POINT) }]]
    ])

    expect(geometry.layers.habitats).toEqual([
      { featureId: 'f1', geometry: POLYGON }
    ])
    expect(geometry.layers.trees).toEqual([
      { featureId: 'f2', geometry: POINT }
    ])
    expect(geometry.layers.hedgerows).toEqual([])
    expect(geometry.layers.watercourses).toEqual([])
  })

  test('returns the red line with the area PostGIS measured', async () => {
    const geometry = await readWith([
      ['redLine', [{ geoJson: JSON.stringify(POLYGON), areaSqm: '120000' }]]
    ])

    expect(geometry.redLine).toEqual({ geometry: POLYGON })
    // pg returns numerics as strings; a string area would format as NaN
    // hectares on the page rather than failing.
    expect(geometry.redLineAreaSqm).toBe(120000)
  })

  test('reports no red line rather than throwing when a project has none', async () => {
    const geometry = await readWith([])

    expect(geometry.redLine).toBeNull()
    expect(geometry.redLineAreaSqm).toBe(0)
  })

  test('reads the post-intervention tables when asked for that side', async () => {
    const schema = await import('./schema/index.js')
    const { drizzle, tables } = createMockDrizzle(new Map())

    await readProjectGeometry(drizzle, 'project-1', 'postIntervention')

    expect(tables).toContain(schema.postInterventionHabitats)
    expect(tables).not.toContain(schema.baselineHabitats)
  })

  test('caps each layer, and says which layers it capped', async () => {
    const geometry = await readWith([['habitats', habitatRows(5)]], {
      maxFeaturesPerLayer: 3
    })

    // Nothing upstream bounds how many features a project holds, and the
    // report holds its whole document in memory — so the read is what has to
    // be bounded, and a shortened layer has to be declared rather than
    // silently drawn as if it were the whole site.
    expect(geometry.layers.habitats).toHaveLength(3)
    expect(geometry.cappedLayers).toEqual(['habitats'])
    expect(geometry.maxFeaturesPerLayer).toBe(3)
  })

  test('reports no capping when a layer ends exactly on the ceiling', async () => {
    const geometry = await readWith([['habitats', habitatRows(3)]], {
      maxFeaturesPerLayer: 3
    })

    // The read asks for one row past the ceiling precisely so that "exactly
    // 3" and "more than 3" are distinguishable; a report that claimed to be
    // partial when it was complete would be its own kind of wrong.
    expect(geometry.layers.habitats).toHaveLength(3)
    expect(geometry.cappedLayers).toEqual([])
  })

  test('bounds the read in SQL rather than after the rows arrive', async () => {
    const tables = await baselineTables()
    const { drizzle, limits } = createMockDrizzle(
      rowsFor(tables, [['habitats', habitatRows(5)]])
    )

    await readProjectGeometry(drizzle, 'project-1', 'baseline', {
      maxFeaturesPerLayer: 3
    })

    // Slicing in JavaScript would still have read — and parsed — every row of
    // an arbitrarily large layer, which is the cost the cap exists to avoid.
    expect(limits).toContainEqual({ table: tables.habitats, count: 4 })
  })

  test('refuses an unknown document key', async () => {
    const { drizzle } = createMockDrizzle(new Map())

    await expect(
      readProjectGeometry(drizzle, 'project-1', 'somethingElse')
    ).rejects.toThrow(/Unknown document key/)
  })
})
