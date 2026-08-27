/**
 * The basemap credit, which is the licensing half of drawing OS mapping.
 *
 * Text DRAWN on a page is not greppable in the finished PDF — it lives in a
 * compressed content stream as glyph ids — so the credit cannot be asserted
 * from the document tests the way the tagged structure can. These tests work
 * against a recording stand-in for pdfkit instead, which is also the only way
 * to assert WHERE it lands and at what size.
 */

import { describe, expect, test } from 'vitest'

import { drawCredit, fitCredit } from './page-furniture.js'
import {
  CREDIT_FONT_SIZE,
  CREDIT_INSET,
  CREDIT_MIN_FONT_SIZE,
  MINI_MAP_SIZE
} from './layout.js'

const FULL = 'Contains OS data © Crown copyright and database right 2026'
const SHORT = '© Crown copyright'

/** A site map panel: half the content width, minus the gutter. */
const SITE_MAP_FRAME = { x: 40, y: 100, width: 249.64, height: 210 }
const THUMBNAIL_FRAME = {
  x: 42,
  y: 300,
  width: MINI_MAP_SIZE,
  height: MINI_MAP_SIZE
}

/**
 * pdfkit, reduced to what a credit touches. Widths are proportional to the
 * font size and the character count, which is the only property of real text
 * measurement the fitting logic depends on.
 */
const CHARACTER_WIDTH_RATIO = 0.5

function fakeDoc() {
  const calls = []
  const record =
    (name) =>
    (...args) => {
      calls.push({ name, args })
      return doc
    }
  const doc = {
    calls,
    size: null,
    font: record('font'),
    fontSize(size) {
      this.size = size
      calls.push({ name: 'fontSize', args: [size] })
      return this
    },
    widthOfString(text) {
      return text.length * this.size * CHARACTER_WIDTH_RATIO
    },
    save: record('save'),
    restore: record('restore'),
    rect: record('rect'),
    fillColor: record('fillColor'),
    fillOpacity: record('fillOpacity'),
    fill: record('fill'),
    text: record('text')
  }
  return doc
}

function callTo(doc, name) {
  return doc.calls.find((call) => call.name === name)
}

describe('#fitCredit', () => {
  test('uses the full wording where it fits, at the full size', () => {
    const credit = fitCredit(fakeDoc(), SITE_MAP_FRAME, [FULL, SHORT])

    expect(credit.text).toBe(FULL)
    expect(credit.size).toBe(CREDIT_FONT_SIZE)
  })

  test('falls back to the short wording in a thumbnail, shrunk to fit', () => {
    const credit = fitCredit(fakeDoc(), THUMBNAIL_FRAME, [FULL, SHORT])

    // An 18 mm square cannot carry a whole sentence at any readable size, and
    // shrinking the full wording until it did would produce an unreadable one.
    expect(credit.text).toBe(SHORT)
    expect(credit.size).toBeLessThan(CREDIT_FONT_SIZE)
    expect(credit.size).toBeGreaterThanOrEqual(CREDIT_MIN_FONT_SIZE)
    expect(credit.width).toBeLessThanOrEqual(THUMBNAIL_FRAME.width)
  })

  test('returns null rather than an illegible credit', () => {
    const credit = fitCredit(fakeDoc(), { width: 12 }, [FULL, SHORT])

    // The caller reads this as "draw no OS mapping here" — the invariant the
    // whole arrangement rests on.
    expect(credit).toBeNull()
  })

  test('returns null when no wording is configured', () => {
    expect(fitCredit(fakeDoc(), SITE_MAP_FRAME, [null, ''])).toBeNull()
  })
})

describe('#drawCredit', () => {
  test('sits inside the bottom-right corner of the frame', () => {
    const doc = fakeDoc()
    const credit = fitCredit(doc, SITE_MAP_FRAME, [FULL, SHORT])

    drawCredit(doc, SITE_MAP_FRAME, credit)

    const [, x, y] = callTo(doc, 'text').args
    // Bottom RIGHT: the scale bar has the bottom left.
    expect(x + credit.width).toBeCloseTo(
      SITE_MAP_FRAME.x + SITE_MAP_FRAME.width - CREDIT_INSET
    )
    expect(y).toBeGreaterThan(SITE_MAP_FRAME.y + SITE_MAP_FRAME.height / 2)
    expect(y).toBeLessThan(SITE_MAP_FRAME.y + SITE_MAP_FRAME.height)
  })

  test('lays a plate under the wording so it reads over any mapping', () => {
    const doc = fakeDoc()
    const credit = fitCredit(doc, SITE_MAP_FRAME, [FULL, SHORT])

    drawCredit(doc, SITE_MAP_FRAME, credit)

    // Grey text on a grey roof is not a credit. The plate is wider than the
    // wording it backs, on both sides.
    const [, , plateWidth] = callTo(doc, 'rect').args
    expect(plateWidth).toBeGreaterThan(credit.width)
    expect(callTo(doc, 'fillOpacity').args[0]).toBeLessThan(1)
  })

  test('draws the wording it was given', () => {
    const doc = fakeDoc()
    const credit = fitCredit(doc, SITE_MAP_FRAME, [FULL, SHORT])

    drawCredit(doc, SITE_MAP_FRAME, credit)

    expect(callTo(doc, 'text').args[0]).toContain(FULL)
  })
})
