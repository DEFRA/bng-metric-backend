/**
 * The card layout, which exists to carry more attributes per parcel than a row
 * of columns can.
 *
 * Asserted against the tagged structure rather than the drawn page: text drawn
 * into a PDF lives in a compressed content stream as glyph ids and is not
 * greppable, whereas structure element dictionaries are — and the structure is
 * what assistive technology reads, so it is the thing worth pinning.
 */

import PDFDocument from 'pdfkit'
import { describe, expect, test } from 'vitest'

import { buildSiteReportPdf } from './document.js'
import {
  CARD_FIELDS,
  cardHeight,
  cardValues,
  labelWidth
} from './habitat-cards.js'
import { BODY, BOLD, registerFonts } from './page-furniture.js'
import {
  CARD_GUTTER,
  CARD_HEADING_HEIGHT,
  CARD_MAP_SIZE,
  CARD_PADDING,
  CONTENT_WIDTH,
  FONT_SIZE
} from './layout.js'
import { toBuffer } from '../build-site-report.js'
import {
  baselineSite,
  postInterventionSite
} from '../site-model.test-fixtures.js'

/**
 * A card's height is measured, not counted — two of its fields are free text
 * and wrap — so the height functions need a document with the real fonts
 * registered to ask. This is that document, and nothing is ever drawn into it.
 */
function measuringDoc() {
  const doc = new PDFDocument({ autoFirstPage: false })
  registerFonts(doc)
  return doc
}

async function render(options) {
  const { doc, stats } = await buildSiteReportPdf({
    layout: 'cards',
    ...options
  })
  const pdf = await toBuffer(doc)
  return { pdf, stats, text: pdf.toString('latin1') }
}

function countOf(text, marker) {
  return text.split(marker).length - 1
}

describe('#cardValues', () => {
  test('formats size in hectares and units to two places', () => {
    const values = cardValues({
      properties: { ref: 'A1', sizeSquareMetres: 60_000, units: 3.6 }
    })

    expect(values.area).toBe('6.000 ha')
    expect(values.units).toBe('3.60')
  })

  test('leaves an unrecorded attribute null so its line can be omitted', () => {
    // A project that has not been through the metric engine has no
    // distinctiveness and no units. A blank line invites the reader to wonder
    // what is missing; a shorter card simply says less.
    const values = cardValues({
      properties: { ref: 'A1', type: 'Cereal crops' }
    })

    expect(values).toMatchObject({
      distinctiveness: null,
      units: null,
      area: null
    })
  })

  test('falls back to a dash for the two fields that identify the parcel', () => {
    // ref and type are the heading. A card with no heading is unnavigable,
    // so these degrade rather than disappear.
    expect(cardValues({ properties: {} })).toMatchObject({
      ref: '—',
      type: '—'
    })
  })

  test('writes a band and its score on one line, not two', () => {
    // "Low (2)" is how the habitat detail screens write it. A reader moving
    // between the service and the report should not have to learn a second
    // spelling of the same fact — and it costs one line rather than two.
    const values = cardValues({
      properties: {
        condition: 'Poor',
        conditionScore: 2,
        distinctiveness: 'Medium',
        distinctivenessScore: 4,
        difficulty: 'Medium',
        difficultyMultiplier: 0.67
      }
    })

    expect(values).toMatchObject({
      condition: 'Poor (2)',
      distinctiveness: 'Medium (4)',
      difficulty: 'Medium (0.67)'
    })
  })

  test('shows the band alone when its score has not been calculated', () => {
    // Uploaded but not yet run through the engine: the band came off the
    // GeoPackage, the score is the engine's to supply.
    const values = cardValues({ properties: { condition: 'Poor' } })

    expect(values.condition).toBe('Poor')
  })

  test('words a bare number of years rather than printing it naked', () => {
    // "Time to target: 10" reads as an identifier. Singular is spelled too,
    // because "1 years" is the kind of detail a reader notices instead of the
    // number it was meant to convey.
    expect(
      cardValues({ properties: { standardTimeToTargetCondition: 10 } })
        .standardTimeToTargetCondition
    ).toBe('10 years')
    expect(
      cardValues({ properties: { standardTimeToTargetCondition: 1 } })
        .standardTimeToTargetCondition
    ).toBe('1 year')
  })

  test('words a bare number that arrived as a string', () => {
    // Which is how the engine actually supplies standardTimeToTargetCondition
    // on a real upload — "10", not 10. Testing only the number shape passed
    // while every real report printed a naked "10".
    expect(
      cardValues({ properties: { standardTimeToTargetCondition: '10' } })
        .standardTimeToTargetCondition
    ).toBe('10 years')
  })

  test('leaves already-worded time values alone', () => {
    // finalTimeToTargetCondition arrives phrased, with the time multiplier the
    // engine used: it contains more than a number, so it passes through.
    expect(
      cardValues({
        properties: { finalTimeToTargetCondition: '10 years (0.7002822742)' }
      }).finalTimeToTargetCondition
    ).toBe('10 years (0.7002822742)')
  })

  test('strips the list prefix a GeoPackage puts on a retention category', () => {
    // The backend normalises this when choosing which calculation to run but
    // never writes it back, so the document keeps whatever the upload carried.
    // The service normalises on display; the report has to do the same or the
    // two disagree about the same parcel.
    expect(
      cardValues({ properties: { retentionCategory: '1. Retained' } })
        .retentionCategory
    ).toBe('Retained')
  })

  test('carries the post-intervention calculation fields', () => {
    // The "how was this number arrived at" set, which exists only after
    // intervention — see the fixture.
    const values = cardValues(postInterventionSite().layers.habitats[0])

    expect(values).toMatchObject({
      difficulty: 'Medium (0.67)',
      standardTimeToTargetCondition: '10 years',
      advanceOrDelay: 'Advance - 2 years',
      finalTimeToTargetCondition: '8 years (0.7002822742)'
    })
  })

  test('rejects a non-finite size rather than formatting NaN onto the page', () => {
    expect(
      cardValues({ properties: { sizeSquareMetres: Number.NaN } }).area
    ).toBeNull()
  })
})

describe('#cardHeight', () => {
  test('grows with the number of recorded attributes', () => {
    const doc = measuringDoc()
    const sparse = cardValues({ properties: { ref: 'A1', condition: 'Poor' } })
    const full = cardValues({
      properties: {
        ref: 'A1',
        broadType: 'Grassland',
        condition: 'Poor',
        distinctiveness: 'Low',
        strategicSignificance: 'Low',
        retentionCategory: 'Retained',
        sizeSquareMetres: 60_000,
        units: 3.6
      }
    })

    expect(cardHeight(doc, full)).toBeGreaterThan(cardHeight(doc, sparse))
  })

  test('never shrinks below the mini-map it has to contain', () => {
    const doc = measuringDoc()
    const empty = cardValues({ properties: { ref: 'A1' } })

    // The map is the tallest fixed thing on a card, so even a parcel with
    // nothing recorded gets a card big enough to draw it in.
    expect(cardHeight(doc, empty)).toBeGreaterThanOrEqual(96)
  })

  test('grows with the LENGTH of a free-text field, not just the count', () => {
    // Comment and survey details are unbounded. A card sized by counting lines
    // would give a two-word comment and a two-paragraph one the same box, and
    // the longer one would spill through the card's own border.
    const doc = measuringDoc()
    const short = cardValues({ properties: { ref: 'A1', comment: 'Dry.' } })
    const long = cardValues({
      properties: { ref: 'A1', comment: 'Dry. '.repeat(120) }
    })

    expect(cardHeight(doc, long)).toBeGreaterThan(cardHeight(doc, short))
  })

  test('is tall enough to contain the text as it will actually be drawn', () => {
    // The value is drawn BOLD, and bold is the wider face. Measuring in the
    // regular face reports fewer lines than the renderer goes on to draw, and
    // the overflow lands outside the card's own border — visible on the page,
    // invisible to every test that only counts lines. So assert containment
    // against the same face, size and column width the renderer will use.
    const doc = measuringDoc()
    const comment = 'Modified grassland in poor condition. '.repeat(30)
    const values = cardValues({ properties: { ref: 'A1', comment } })

    const valueWidth =
      CONTENT_WIDTH -
      CARD_PADDING * 2 -
      CARD_MAP_SIZE -
      CARD_GUTTER -
      labelWidth(doc)
    doc.font(BOLD).fontSize(FONT_SIZE.bodySmall)
    const asDrawn = doc.heightOfString(`${comment} `, { width: valueWidth })

    expect(cardHeight(doc, values)).toBeGreaterThanOrEqual(
      CARD_HEADING_HEIGHT + asDrawn + CARD_PADDING * 2
    )
  })
})

describe('#labelWidth', () => {
  test('is wide enough for the longest label, with clear space after it', () => {
    // A label that overflows its column wraps, and a non-wrapping field
    // advances by exactly one line height — so the wrapped label is drawn
    // through the row beneath it. Sizing the column to the labels makes that
    // impossible rather than merely unlikely, which matters because the
    // typeface is a deployment option.
    const doc = measuringDoc()
    doc.font(BODY).fontSize(FONT_SIZE.bodySmall)
    const widest = Math.max(
      ...CARD_FIELDS.map(({ label }) => doc.widthOfString(`${label}: `))
    )

    expect(labelWidth(doc)).toBeGreaterThan(widest)
  })
})

describe('#addHabitatCards', () => {
  test('gives every parcel a heading, so a card can be navigated to', async () => {
    const { text } = await render({ baseline: baselineSite() })

    // H3, because the section's own heading is an H2 — a screen reader moves
    // card to card by heading, which is what a table gave through its rows.
    expect(countOf(text, '/S /H3')).toBe(2)
  })

  test('gives every parcel a tagged mini-map with alt text', async () => {
    const { text } = await render({ baseline: baselineSite() })

    expect(text).toContain('Outline of parcel A1')
    expect(text).toContain('Outline of parcel A2')
  })

  test('writes one paragraph per recorded attribute, and none for the rest', async () => {
    const { text } = await render({ baseline: baselineSite() })

    // A1 is fully recorded for a BASELINE parcel (12 attributes); A2 has only
    // broad habitat, condition and size. The five remaining card fields are
    // post-intervention only, so neither parcel has them here. Three
    // paragraphs belong to the page introductions.
    const introductions = 3
    expect(countOf(text, '/S /P')).toBe(introductions + 12 + 3)
  })

  test('carries the values the table layout has no column for', async () => {
    const { pdf } = await render({ baseline: baselineSite() })

    // Drawn text is not greppable, so assert on what reached the builder
    // instead: a card shows twelve fields where the table shows four.
    expect(pdf.length).toBeGreaterThan(0)
    const values = cardValues(baselineSite().layers.habitats[0])
    expect(values).toMatchObject({
      // Band and score on one line, the way the habitat detail screens write
      // it, rather than spending a second line on the number.
      distinctiveness: 'Low (2)',
      condition: 'Poor (2)',
      strategicSignificance: 'Location ecologically desirable',
      retentionCategory: 'Retained',
      spatialRiskCategory: 'Within LPA',
      status: 'Complete',
      surveyDate: '2025-06-14',
      units: '3.60'
    })
  })

  test('counts each parcel once, whichever layout drew it', async () => {
    const cards = await render({ baseline: baselineSite() })
    const table = await render({ baseline: baselineSite(), layout: 'table' })

    expect(cards.stats.habitats).toBe(2)
    expect(table.stats.habitats).toBe(2)
  })

  test('produces no habitat section at all when there are no parcels', async () => {
    const baseline = baselineSite()
    baseline.layers.habitats = []

    const { text } = await render({ baseline })

    expect(countOf(text, '/S /H3')).toBe(0)
  })
})
