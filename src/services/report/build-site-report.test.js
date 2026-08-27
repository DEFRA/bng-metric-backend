import { afterEach, describe, expect, test, vi } from 'vitest'

import { buildSiteReport } from './build-site-report.js'
import { baselineSite } from './site-model.test-fixtures.js'
import {
  TEST_GRID,
  syntheticTileSource
} from './pdf/synthetic-tiles.test-fixtures.js'
import { config } from '../../config.js'

vi.mock('./site-data.js', async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, readSiteData: vi.fn() }
})

const { readSiteData } = await import('./site-data.js')

function siteData() {
  return {
    siteName: 'Test Farm',
    baseline: baselineSite(),
    postIntervention: null
  }
}

function fakeOsTiles(overrides = {}) {
  return {
    getPublishedGrid: vi.fn().mockResolvedValue(TEST_GRID),
    getTile: vi.fn(async (z, col, row) => ({
      png: syntheticTileSource()(TEST_GRID, z, col, row).png,
      contentType: 'image/png',
      cached: false
    })),
    ...overrides
  }
}

// `clearMocks` resets calls but not implementations, so a config spy set by one
// test would otherwise leak into every test after it.
afterEach(() => {
  vi.restoreAllMocks()
})

describe('#buildSiteReport', () => {
  test('returns PDF bytes with the site name for the filename', async () => {
    readSiteData.mockResolvedValue(siteData())

    const { pdf, siteName, stats } = await buildSiteReport({
      drizzle: {},
      projectRow: { id: 'project-1', project: {} }
    })

    expect(siteName).toBe('Test Farm')
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(stats.habitats).toBe(2)
  })

  test('draws no basemap when the deployment has not enabled one', async () => {
    readSiteData.mockResolvedValue(siteData())
    const osTiles = fakeOsTiles()

    const { stats } = await buildSiteReport({
      drizzle: {},
      projectRow: { id: 'project-1', project: {} },
      osTiles
    })

    // report.basemap defaults to false — an OS basemap in a downloadable PDF
    // is an unanswered licensing question, not a technical one.
    expect(config.get('report.basemap')).toBe(false)
    expect(osTiles.getPublishedGrid).not.toHaveBeenCalled()
    expect(stats.tiles).toBe(0)
  })

  test('draws a basemap when one is enabled and available', async () => {
    readSiteData.mockResolvedValue(siteData())
    const osTiles = fakeOsTiles()
    vi.spyOn(config, 'get').mockImplementation((key) =>
      key === 'report.basemap' ? true : config.default(key)
    )

    const { stats } = await buildSiteReport({
      drizzle: {},
      projectRow: { id: 'project-1', project: {} },
      osTiles
    })

    expect(stats.tiles).toBeGreaterThan(0)
  })

  test('degrades to no basemap rather than failing when OS is unreachable', async () => {
    readSiteData.mockResolvedValue(siteData())
    const osTiles = fakeOsTiles({
      getPublishedGrid: vi.fn().mockRejectedValue(new Error('upstream down'))
    })
    vi.spyOn(config, 'get').mockImplementation((key) =>
      key === 'report.basemap' ? true : config.default(key)
    )

    const { pdf, stats } = await buildSiteReport({
      drizzle: {},
      projectRow: { id: 'project-1', project: {} },
      osTiles
    })

    // A report on a plain ground is still a correct, useful report. Refusing to
    // produce one because Ordnance Survey is down would turn a cosmetic
    // dependency into an outage.
    expect(stats.tiles).toBe(0)
    expect(pdf.length).toBeGreaterThan(0)
  })
})
