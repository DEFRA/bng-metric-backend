import { afterEach, describe, expect, test, vi } from 'vitest'

import { buildSiteReport } from './build-site-report.js'
import { baselineSite } from './site-model.test-fixtures.js'
import {
  TEST_GRID,
  syntheticTileSource,
  syntheticVectorTile
} from './pdf/synthetic-tiles.test-fixtures.js'
import { config } from '../../config.js'
import { OsTileError } from '../os-tiles/errors.js'

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
    getPublishedVectorGrid: vi.fn().mockResolvedValue(TEST_GRID),
    getVectorTile: vi.fn(async (z, col, row) => ({
      pbf: syntheticVectorTile(TEST_GRID, z, col, row),
      contentType: 'application/vnd.mapbox-vector-tile',
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

  test('draws no basemap when the service holds no OS key', async () => {
    readSiteData.mockResolvedValue(siteData())

    // No key means no OS tiles service is passed at all — the absence of a
    // credential, not a separate switch, is what keeps OS mapping out of the
    // document while the embedding question is open.
    const { stats } = await buildSiteReport({
      drizzle: {},
      projectRow: { id: 'project-1', project: {} },
      osTiles: null
    })

    expect(stats.tiles).toBe(0)
  })

  test('draws the vector basemap by default whenever OS tiles are available', async () => {
    readSiteData.mockResolvedValue(siteData())
    const osTiles = fakeOsTiles()

    const { stats } = await buildSiteReport({
      drizzle: {},
      projectRow: { id: 'project-1', project: {} },
      osTiles
    })

    expect(osTiles.getPublishedVectorGrid).toHaveBeenCalled()
    expect(osTiles.getPublishedGrid).not.toHaveBeenCalled()
    expect(stats.tiles).toBeGreaterThan(0)
  })

  test('draws the raster basemap when the request asks for it', async () => {
    readSiteData.mockResolvedValue(siteData())
    const osTiles = fakeOsTiles()

    const { stats } = await buildSiteReport({
      drizzle: {},
      projectRow: { id: 'project-1', project: {} },
      osTiles,
      basemap: 'raster'
    })

    expect(osTiles.getPublishedGrid).toHaveBeenCalled()
    expect(osTiles.getPublishedVectorGrid).not.toHaveBeenCalled()
    expect(stats.tiles).toBeGreaterThan(0)
  })

  test('draws no OS mapping at all when there is no wording to credit it with', async () => {
    readSiteData.mockResolvedValue(siteData())
    const osTiles = fakeOsTiles()
    vi.spyOn(config, 'get').mockImplementation((key) =>
      key.startsWith('osMaps.attribution') ? '' : config.default(key)
    )

    const { stats } = await buildSiteReport({
      drizzle: {},
      projectRow: { id: 'project-1', project: {} },
      osTiles
    })

    // The credit is not decoration that can be dropped when it is awkward: a
    // frame that cannot carry one gets no OS tiles behind it.
    expect(stats.tiles).toBe(0)
  })

  test('redraws on a plain ground when a tile fails mid-render', async () => {
    readSiteData.mockResolvedValue(siteData())
    // The grid resolves, so the report commits to an OS basemap — and then a
    // tile fails once drawing has already started, which is the case
    // resolveBasemap cannot see.
    const osTiles = fakeOsTiles({
      getVectorTile: vi.fn().mockRejectedValue(
        new OsTileError('vector tile 9/1/1: 504 Gateway Timeout', {
          status: 504,
          upstream: true
        })
      )
    })

    const { pdf, stats } = await buildSiteReport({
      drizzle: {},
      projectRow: { id: 'project-1', project: {} },
      osTiles
    })

    // The request had already committed to producing a report. Failing it over
    // a picture would be the same outage resolveBasemap exists to avoid,
    // arriving through the other door.
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(stats.tiles).toBe(0)
    expect(stats.basemapDegraded).toBe(true)
  })

  test('redraws on a plain ground when a raster tile is not an image', async () => {
    readSiteData.mockResolvedValue(siteData())
    // A 200 carrying an HTML error page — what a gateway in front of
    // api.os.uk answers with when it is having a bad day, `content-type`
    // included. Raised in review on #297.
    const osTiles = fakeOsTiles({
      getTile: vi.fn().mockResolvedValue({
        png: Buffer.from('<html><body>Service Unavailable</body></html>'),
        contentType: 'image/png',
        cached: false
      })
    })

    const { pdf, stats } = await buildSiteReport({
      drizzle: {},
      projectRow: { id: 'project-1', project: {} },
      osTiles,
      basemap: 'raster'
    })

    // Unclassified, these bytes reach doc.image and throw a bare
    // Error('Unknown image format.') — indistinguishable at the builder from a
    // fault in the drawing, so the report 500s instead of degrading.
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(stats.tiles).toBe(0)
    expect(stats.basemapDegraded).toBe(true)
  })

  test('does not hide a drawing fault behind a substituted basemap', async () => {
    readSiteData.mockResolvedValue(siteData())
    // Not an OsTileError: the service raises those for everything that can go
    // wrong with a tile, so anything else from this seam is a bug in the code,
    // and a bug that silently produces a slightly different report is a bug
    // nobody ever finds.
    const osTiles = fakeOsTiles({
      getVectorTile: vi
        .fn()
        .mockRejectedValue(new TypeError('cannot read property of undefined'))
    })

    await expect(
      buildSiteReport({
        drizzle: {},
        projectRow: { id: 'project-1', project: {} },
        osTiles
      })
    ).rejects.toThrow(TypeError)
  })

  test('degrades to no basemap rather than failing when OS is unreachable', async () => {
    readSiteData.mockResolvedValue(siteData())
    const osTiles = fakeOsTiles({
      getPublishedVectorGrid: vi
        .fn()
        .mockRejectedValue(new Error('upstream down'))
    })

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
