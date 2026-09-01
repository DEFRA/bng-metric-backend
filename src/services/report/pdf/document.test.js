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
import path from 'node:path'
import { readFile } from 'node:fs/promises'

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

  test('renders without a basemap when given none, and says nothing about OS', async () => {
    const { pdf, stats, text } = await render({ baseline: baselineSite() })

    expect(stats.tiles).toBe(0)
    expect(stats.zooms).toEqual([])
    expect(text).not.toContain('Crown copyright')
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  test('draws a basemap, and credits it, when given one', async () => {
    const plain = await render({ baseline: baselineSite() })
    const mapped = await render({
      baseline: baselineSite(),
      grid: TEST_GRID,
      tileSource: syntheticTileSource(),
      attribution: 'Contains OS data (C) Crown copyright'
    })

    expect(mapped.stats.tiles).toBeGreaterThan(0)
    expect(mapped.stats.zooms.length).toBe(1)
    // The credit is burned into the corner of every map — drawn text, so not
    // greppable here (see the note above) and unit-tested in
    // page-furniture.test.js. What IS assertable is the tagged paragraph that
    // puts the same wording into the reading order once: one more P than the
    // unmapped version has.
    expect(countOf(mapped.text, '/S /P')).toBe(countOf(plain.text, '/S /P') + 1)
  })

  test('draws no basemap at all when there is no wording to credit it with', async () => {
    const uncreditable = await render({
      baseline: baselineSite(),
      grid: TEST_GRID,
      tileSource: syntheticTileSource()
    })
    const plain = await render({ baseline: baselineSite() })

    // Not "a basemap with no credit" — no basemap. A credit that can be
    // dropped when it is inconvenient is not a licensing position.
    expect(uncreditable.stats.tiles).toBe(0)
    expect(countOf(uncreditable.text, '/S /P')).toBe(
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

/**
 * A typeface held outside this repository still has to end up EMBEDDED, which
 * is what PDF/UA 7.21.4.1 requires and what pdfkit's base-14 defaults never do.
 * Asserting the call reached pdfkit is not enough — the proof is a font program
 * in the finished file.
 *
 * The committed Noto Sans stands in for the privately held font here: read as
 * bytes, it travels the same path an object fetched from S3 does.
 */
describe('#buildSiteReportPdf font source', () => {
  async function bundledAsBuffers() {
    const dir = path.resolve(import.meta.dirname, '..', 'assets', 'fonts')
    const [regular, bold] = await Promise.all([
      readFile(path.join(dir, 'NotoSans-Regular.ttf')),
      readFile(path.join(dir, 'NotoSans-Bold.ttf'))
    ])
    return { regular, bold }
  }

  test('embeds font programs from buffers, not by reference', async () => {
    const { text } = await render({
      baseline: baselineSite(),
      fonts: await bundledAsBuffers()
    })

    // /FontFile2 is the embedded TrueType program itself. Its absence — with
    // /BaseFont naming Helvetica instead — is exactly the failure veraPDF
    // reported as 7.21.4.1-1, and it is invisible on screen.
    expect(countOf(text, '/FontFile2')).toBe(2)
    expect(text).not.toContain('/BaseFont /Helvetica')
  })

  test('produces the same embedded structure as the committed files', async () => {
    const fromBuffers = await render({
      baseline: baselineSite(),
      fonts: await bundledAsBuffers()
    })
    const fromFiles = await render({ baseline: baselineSite() })

    // Same fonts, two ways of reaching pdfkit: the subset names it assigns are
    // derived from the font program, so matching names mean matching programs.
    // Each weight contributes two entries — the Type0 font and its descendant
    // CIDFontType2 — so two weights is four names and two distinct ones.
    const subsets = (text) =>
      [...text.matchAll(/\/BaseFont \/(\S+)/g)].map(([, name]) => name)
    expect(subsets(fromBuffers.text)).toEqual(subsets(fromFiles.text))
    expect(new Set(subsets(fromBuffers.text)).size).toBe(2)
  })
})

describe('#buildSiteReportPdf habitat layout', () => {
  test('defaults to the table layout', async () => {
    const { text } = await render({ baseline: baselineSite() })

    // Column headers exist only in the table layout; card headings only in the
    // card one. Each is a clean fingerprint for which builder ran.
    expect(countOf(text, '/S /TH')).toBeGreaterThan(0)
    expect(countOf(text, '/S /H3')).toBe(0)
  })

  test('draws cards when asked for them', async () => {
    const { text } = await render({ baseline: baselineSite(), layout: 'cards' })

    expect(countOf(text, '/S /H3')).toBe(2)
  })

  test('falls back to the table for a layout it does not have', async () => {
    // The route validates the parameter, so this is defence in depth: an
    // unknown layout produces the standard report rather than a blank one.
    const { text } = await render({
      baseline: baselineSite(),
      layout: 'trellis'
    })

    expect(countOf(text, '/S /TH')).toBeGreaterThan(0)
  })
})
