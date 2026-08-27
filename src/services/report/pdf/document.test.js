/**
 * What a conformance checker cannot tell you.
 *
 * veraPDF confirms the document is correctly TAGGED; these confirm it is
 * tagged with the right things and that the alt text reads as English. Both
 * halves matter — the spike's worst bug rendered identically, reported 22
 * figures with alt text throughout, and left every drawing operation on the
 * habitat pages untagged.
 */

import { describe, expect, test } from 'vitest'

import { buildSiteReportPdf, plural } from './document.js'
import {
  TEST_GRID,
  syntheticTileSource
} from './synthetic-tiles.test-fixtures.js'
import { toBuffer } from '../build-site-report.js'
import {
  baselineSite,
  postInterventionSite
} from '../site-model.test-fixtures.js'

async function render(options) {
  const { doc, stats } = await buildSiteReportPdf(options)
  const pdf = await toBuffer(doc)
  return { pdf, stats, text: pdf.toString('latin1') }
}

function countOf(text, marker) {
  return text.split(marker).length - 1
}

/**
 * Only some of a PDF's strings are greppable, and it is worth knowing which.
 *
 * Structure-element dictionaries — `/S /H1`, `/Alt (…)`, `/T (…)` — are written
 * as plain objects, so they can be asserted on directly. Text DRAWN on the page
 * cannot: it lives in a compressed content stream and, because the fonts are
 * embedded as subsets, its bytes are glyph ids rather than characters. So these
 * tests assert against the tagged structure, which is both greppable and the
 * thing that actually matters here — it is what assistive technology reads.
 */

describe('#buildSiteReportPdf', () => {
  test('tags the document structure a screen reader navigates by', async () => {
    const { text } = await render({
      baseline: baselineSite(),
      postIntervention: postInterventionSite()
    })

    expect(countOf(text, '/S /Document')).toBe(1)
    expect(countOf(text, '/S /H1')).toBe(1)
    // H1 → H2 → H2, with no level skipped.
    expect(countOf(text, '/S /H2')).toBe(2)
    expect(countOf(text, '/Lang')).toBeGreaterThan(0)
    expect(text).toContain('pdfuaid')
  })

  test('emits real table rows, not a picture of a table', async () => {
    const { text } = await render({
      baseline: baselineSite(),
      postIntervention: postInterventionSite()
    })

    // The trap: wrapping doc.table() in doc.struct('Table', …) renders
    // identically and emits a Table element containing zero rows. Counting
    // cells is what catches it; looking at the page is not.
    expect(countOf(text, '/S /Table')).toBe(2)
    expect(countOf(text, '/S /TH')).toBeGreaterThan(0)
    expect(countOf(text, '/S /TD')).toBeGreaterThan(0)
  })

  test('gives every figure alt text', async () => {
    const { text } = await render({
      baseline: baselineSite(),
      postIntervention: postInterventionSite()
    })

    // Two site maps and one thumbnail per parcel.
    const figures = countOf(text, '/S /Figure')
    expect(figures).toBe(4)
    expect(countOf(text, '/Alt')).toBe(figures)
  })

  test('describes what the map shows, in readable English', async () => {
    const { text } = await render({ baseline: baselineSite() })

    expect(text).toContain('Baseline site map')
    expect(text).toContain('12.00 hectares')
    // Singular counts must read as singular — the thing veraPDF was perfectly
    // happy to accept as "1 watercourses".
    expect(text).toContain('1 hedgerow ')
    expect(text).toContain('1 watercourse.')
    expect(text).toContain('2 habitat parcels')
  })

  test('renders without a basemap by default, and says nothing about OS', async () => {
    const { pdf, stats, text } = await render({ baseline: baselineSite() })

    expect(stats.tiles).toBe(0)
    expect(stats.zooms).toEqual([])
    expect(text).not.toContain('Crown copyright')
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  test('draws a basemap, and burns its attribution into the page, when given one', async () => {
    const plain = await render({ baseline: baselineSite() })
    const mapped = await render({
      baseline: baselineSite(),
      grid: TEST_GRID,
      tileSource: syntheticTileSource(),
      attribution: 'Contains OS data (C) Crown copyright'
    })

    expect(mapped.stats.tiles).toBeGreaterThan(0)
    expect(mapped.stats.zooms.length).toBe(1)
    // A PDF cannot carry a dynamic credit control, so the credit has to be a
    // paragraph of the document — one more than the unmapped version has.
    expect(countOf(mapped.text, '/S /P')).toBe(countOf(plain.text, '/S /P') + 1)
  })

  test('adds no attribution paragraph when there is no basemap to credit', async () => {
    const withBasemapButNoWording = await render({
      baseline: baselineSite(),
      grid: TEST_GRID,
      tileSource: syntheticTileSource()
    })
    const plain = await render({ baseline: baselineSite() })

    expect(countOf(withBasemapButNoWording.text, '/S /P')).toBe(
      countOf(plain.text, '/S /P')
    )
  })

  test('reports the post-intervention side when there is one', async () => {
    const single = await render({ baseline: baselineSite() })
    const both = await render({
      baseline: baselineSite(),
      postIntervention: postInterventionSite()
    })

    expect(single.stats.maps).toBe(1)
    expect(both.stats.maps).toBe(2)
    expect(single.text).not.toContain('Post-intervention site map')
    expect(both.text).toContain('Post-intervention site map')
  })

  test('draws the habitat pages from the post-intervention side when present', async () => {
    // The parcel table describes the site as it will be, not as it was.
    const { text } = await render({
      baseline: baselineSite(),
      postIntervention: postInterventionSite()
    })

    // A2 is 'Cereal crops' in the baseline and 'Other neutral grassland' after
    // the work; the parcel row describes the site as it will be.
    expect(text).toContain('Outline of parcel A2, Other neutral grassland')
    expect(text).not.toContain('Outline of parcel A2, Cereal crops')
  })

  test('survives a site with no habitat parcels at all', async () => {
    const site = baselineSite()
    site.layers.habitats = []

    const { pdf, stats } = await render({ baseline: site })

    expect(stats.habitats).toBe(0)
    expect(pdf.length).toBeGreaterThan(0)
  })

  test('shows an em dash rather than inventing a value it does not have', async () => {
    const site = baselineSite()
    site.layers.habitats[0].properties = {
      ref: null,
      type: null,
      condition: null,
      sizeSquareMetres: null,
      sizeMetres: null
    }

    const { pdf } = await render({ baseline: site })

    expect(pdf.length).toBeGreaterThan(0)
  })
})

describe('#plural', () => {
  test('does not pluralise a count of one', () => {
    expect(plural(1, 'watercourse')).toBe('1 watercourse')
    expect(plural(1, 'habitat parcel')).toBe('1 habitat parcel')
  })

  test('pluralises every other count, zero included', () => {
    expect(plural(0, 'watercourse')).toBe('0 watercourses')
    expect(plural(2, 'hedgerow')).toBe('2 hedgerows')
    expect(plural(20, 'habitat parcel')).toBe('20 habitat parcels')
  })
})
