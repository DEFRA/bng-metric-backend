import { describe, expect, test, vi } from 'vitest'

import { readProjectGeometry } from './project-geometry.js'

/**
 * A drizzle stand-in that answers each `.from(table)` with whatever rows the
 * test has queued for it. Reading five tables per call is exactly the point of
 * this module, so the fake is keyed by table rather than by call order.
 */
function createMockDrizzle(rowsByTable) {
  const tables = []

  const select = vi.fn(() => ({
    from: vi.fn((table) => {
      tables.push(table)
      const rows = rowsByTable.get(table) ?? []
      const terminal = {
        orderBy: vi.fn().mockResolvedValue(rows),
        limit: vi.fn().mockResolvedValue(rows)
      }
      return { where: vi.fn().mockReturnValue(terminal) }
    })
  }))

  return { drizzle: { select }, tables }
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

async function readWith(entries) {
  const schema = await import('./schema/index.js')
  const tables = {
    redLine: schema.baselineRedLine,
    habitats: schema.baselineHabitats,
    hedgerows: schema.baselineHedgerows,
    watercourses: schema.baselineWatercourses,
    trees: schema.baselineTrees
  }
  const { drizzle } = createMockDrizzle(rowsFor(tables, entries))
  return readProjectGeometry(drizzle, 'project-1', 'baseline')
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

  test('refuses an unknown document key', async () => {
    const { drizzle } = createMockDrizzle(new Map())

    await expect(
      readProjectGeometry(drizzle, 'project-1', 'somethingElse')
    ).rejects.toThrow(/Unknown document key/)
  })
})
