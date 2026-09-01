/**
 * The card layout, which exists to carry more attributes per parcel than a row
 * of columns can.
 *
 * Asserted against the tagged structure rather than the drawn page: text drawn
 * into a PDF lives in a compressed content stream as glyph ids and is not
 * greppable, whereas structure element dictionaries are — and the structure is
 * what assistive technology reads, so it is the thing worth pinning.
 */

import { describe, expect, test } from 'vitest'

import { buildSiteReportPdf } from './document.js'
import { cardHeight, cardValues } from './habitat-cards.js'
import { toBuffer } from '../build-site-report.js'
import { baselineSite } from '../site-model.test-fixtures.js'

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

  test('rejects a non-finite size rather than formatting NaN onto the page', () => {
    expect(
      cardValues({ properties: { sizeSquareMetres: Number.NaN } }).area
    ).toBeNull()
  })
})

describe('#cardHeight', () => {
  test('grows with the number of recorded attributes', () => {
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

    expect(cardHeight(full)).toBeGreaterThan(cardHeight(sparse))
  })

  test('never shrinks below the mini-map it has to contain', () => {
    const empty = cardValues({ properties: { ref: 'A1' } })

    // The map is the tallest fixed thing on a card, so even a parcel with
    // nothing recorded gets a card big enough to draw it in.
    expect(cardHeight(empty)).toBeGreaterThanOrEqual(96)
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

    // A1 is fully recorded (7 attributes); A2 has only broad habitat,
    // condition and size. Three paragraphs belong to the page introductions.
    const introductions = 3
    expect(countOf(text, '/S /P')).toBe(introductions + 7 + 3)
  })

  test('carries the values the table layout has no column for', async () => {
    const { pdf } = await render({ baseline: baselineSite() })

    // Drawn text is not greppable, so assert on what reached the builder
    // instead: a card shows seven fields where the table shows four.
    expect(pdf.length).toBeGreaterThan(0)
    const values = cardValues(baselineSite().layers.habitats[0])
    expect(values).toMatchObject({
      distinctiveness: 'Low',
      strategicSignificance: 'Location ecologically desirable',
      retentionCategory: 'Retained',
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
