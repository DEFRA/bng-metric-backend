/**
 * The summary page, asserted against the tagged structure it produces.
 *
 * Text drawn into a PDF is a compressed stream of glyph ids and cannot be
 * read back (see document.test.js), so what is checked here is the shape a
 * screen reader gets: the sections, their headings, and one paragraph per
 * figure. The wording itself is `unit-summary.js`'s, and is tested there.
 */

import PDFDocument from 'pdfkit'
import { describe, expect, test } from 'vitest'

import { buildSiteReportPdf } from './document.js'
import { BODY, BOLD, registerFonts } from './page-furniture.js'
import {
  A4_PORTRAIT_HEIGHT,
  CONTENT_WIDTH,
  FONT_SIZE,
  MARGIN,
  PRIMARY_TILE_COUNT,
  PRIMARY_TILE_HEIGHT,
  SECONDARY_TILE_COUNT,
  SECONDARY_TILE_HEIGHT,
  TAG_PADDING_Y,
  TILE_GUTTER,
  TILE_PADDING,
  TILE_SECTION_GAP,
  TILE_VALUE_GAP
} from './layout.js'
import { unitTypeSectionHeight } from './summary-tiles.js'
import { toBuffer } from '../build-site-report.js'
import { baselineSite } from '../site-model.test-fixtures.js'

async function render(options) {
  const { doc } = await buildSiteReportPdf(options)
  return (await toBuffer(doc)).toString('latin1')
}

function countOf(text, marker) {
  return text.split(marker).length - 1
}

/** Five tiles to a section, and a sixth paragraph where a tag is drawn. */
const TILES_PER_SECTION = 5

describe('the summary tiles', () => {
  test('gives each unit type its own named section', async () => {
    const text = await render({ baseline: baselineSite() })

    // Sect titles reach the file as plain strings, unlike drawn text, so the
    // sections can be named rather than merely counted.
    expect(text).toContain('/T (Summary)')
    expect(text).toContain('/T (Area habitats)')
    expect(text).toContain('/T (Hedgerows)')
    expect(text).toContain('/T (Watercourses)')
  })

  test('heads each tile, so the figures are navigable rather than a grid', async () => {
    const text = await render({ baseline: baselineSite() })

    // Three unit types in the fixture, five tiles each: the percentage
    // change, trading rules, baseline, post-intervention and net change.
    expect(countOf(text, '/S /H3')).toBe(3 * TILES_PER_SECTION)
  })

  test('writes the verdict as words, never as a colour alone', async () => {
    // The two renders differ in one thing only: whether there is a
    // percentage to judge. Same project, same single section, same five
    // tiles — so any difference in the paragraph count is the tag itself.
    const oneSection = { habitats: 1, hedgerows: 0, watercourses: 0 }
    const judged = await render({
      baseline: baselineSite({
        units: { habitatsTotal: 10 },
        documentCounts: oneSection
      })
    })
    const unjudged = await render({
      baseline: baselineSite({
        units: { habitatsTotal: 0 },
        documentCounts: oneSection
      })
    })

    // "Not met" has to reach assistive technology as text. Drawn as a red
    // panel alone it would be invisible to a screen reader and to anyone who
    // cannot distinguish the colour.
    expect(countOf(judged, '/S /P')).toBe(countOf(unjudged, '/S /P') + 1)
  })

  test('hides a linear section the project has no features for', async () => {
    const text = await render({
      baseline: baselineSite({
        documentCounts: { habitats: 2, hedgerows: 0, watercourses: 0 }
      })
    })

    expect(text).toContain('/T (Area habitats)')
    expect(text).not.toContain('/T (Hedgerows)')
    expect(text).not.toContain('/T (Watercourses)')
  })
})

/**
 * A tile is a FIXED height, so its content has to be known to fit inside it —
 * a heading that wraps to a second line would push the value, and the tag
 * under it, out through the bottom of the panel and onto the page. A document
 * with the real fonts registered is the only thing that can answer how tall a
 * string is; nothing is ever drawn into this one.
 */
function measuringDoc() {
  const doc = new PDFDocument({ autoFirstPage: false })
  registerFonts(doc)
  return doc
}

function contentHeight(
  doc,
  { heading, value, tagged, across, headingFont, headingSize, valueSize }
) {
  const textWidth =
    (CONTENT_WIDTH - TILE_GUTTER * (across - 1)) / across - TILE_PADDING * 2

  doc.font(headingFont).fontSize(headingSize)
  const headingHeight = doc.heightOfString(`${heading} `, { width: textWidth })

  doc.font(BODY).fontSize(valueSize)
  const valueHeight = doc.heightOfString(`${value} `, { width: textWidth })

  doc.font(BOLD).fontSize(FONT_SIZE.tag)
  const tagHeight = tagged
    ? doc.currentLineHeight() + TAG_PADDING_Y * 2 + TILE_VALUE_GAP
    : 0

  return (
    TILE_PADDING +
    headingHeight +
    TILE_VALUE_GAP +
    valueHeight +
    tagHeight +
    TILE_PADDING
  )
}

describe('the tile geometry', () => {
  test('fits the longest wording of every tile inside its panel', () => {
    const doc = measuringDoc()
    const primary = {
      across: PRIMARY_TILE_COUNT,
      headingFont: BOLD,
      headingSize: FONT_SIZE.body,
      valueSize: FONT_SIZE.tileValue
    }
    const secondary = { ...primary, across: SECONDARY_TILE_COUNT }

    const tiles = [
      // The tallest case there is: the longest heading, and a tag under the
      // value.
      [
        {
          heading: 'Total on-site net percentage change',
          value: '-100.00%',
          tagged: true,
          ...primary
        },
        PRIMARY_TILE_HEIGHT
      ],
      [
        {
          heading: 'Trading Rules',
          value: 'View trading rules in the service',
          tagged: false,
          ...primary,
          headingFont: BODY,
          headingSize: FONT_SIZE.tileValue,
          valueSize: FONT_SIZE.body
        },
        PRIMARY_TILE_HEIGHT
      ],
      ...[
        'On-site baseline',
        'On-site post-intervention',
        'Total on-site net unit change'
      ].map((heading) => [
        { heading, value: '-1234.56 units', tagged: false, ...secondary },
        SECONDARY_TILE_HEIGHT
      ])
    ]

    for (const [tile, height] of tiles) {
      expect(contentHeight(doc, tile)).toBeLessThanOrEqual(height)
    }
  })

  test('fits all three unit types on the page, under the heading', () => {
    const UNIT_TYPES = 3
    const headingAllowance = 60

    const needed =
      UNIT_TYPES * unitTypeSectionHeight() + (UNIT_TYPES - 1) * TILE_SECTION_GAP

    // Pagination handles the overflow correctly either way, but a project
    // with all three unit types is the ordinary case and belongs on one page.
    expect(needed).toBeLessThanOrEqual(
      A4_PORTRAIT_HEIGHT - MARGIN * 2 - headingAllowance
    )
  })
})
