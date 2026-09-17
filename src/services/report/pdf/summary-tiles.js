/**
 * Page 1: the summary, laid out like the service's project summary screen.
 *
 * One section per unit type, tile for tile with `app-unit-type-summary` in
 * the frontend:
 *
 *   ┌──────────────────────────────┬──────────────────────────────┐
 *   │ Total on-site net percentage │ Trading Rules                │
 *   │ change    18.42%       [Met] │ View trading rules           │
 *   ├─────────────────┬────────────┴─────┬────────────────────────┤
 *   │ On-site         │ On-site          │ Total on-site net      │
 *   │ baseline        │ post-intervention│ unit change            │
 *   └─────────────────┴──────────────────┴────────────────────────┘
 *
 * The figures are the engine's, read off the project document — see
 * `unit-summary.js`, which owns every wording decision on this page. This
 * module owns only where things sit.
 *
 * The tagged structure mirrors the visual: a Sect per unit type, its name as
 * an H2, each tile's label an H3 with its value as a paragraph. The Met /
 * Not met tag is real text on a coloured panel, never colour alone — the same
 * rule the legend follows.
 *
 * **Every position here is computed, never read back off `doc.y`.** A struct
 * closure does not run when it is created; it runs when the element is
 * attached to the tree, by which point the cursor belongs to whatever drew
 * last. Heights come from `heightOfString` — the same question the renderer
 * answers later, asked at the same width and font.
 */

import { BODY, BOLD, labelAsArtifact } from './page-furniture.js'
import {
  A4_PORTRAIT_HEIGHT,
  CONTENT_WIDTH,
  FONT_SIZE,
  INK,
  MARGIN,
  MUTED,
  PRIMARY_TILE_COUNT,
  PRIMARY_TILE_HEIGHT,
  SECONDARY_TILE_COUNT,
  SECONDARY_TILE_HEIGHT,
  SECTION_HEADING_HEIGHT,
  SUMMARY_TILES_TOP_GAP,
  TAG_COLOURS,
  TAG_PADDING_X,
  TAG_PADDING_Y,
  TILE_BACKGROUND,
  TILE_GUTTER,
  TILE_PADDING,
  TILE_ROW_GAP,
  TILE_SECTION_GAP,
  TILE_VALUE_GAP
} from './layout.js'
import { summariseUnitTypes } from '../unit-summary.js'

/**
 * Add the summary page.
 *
 * Synchronous, alone among the pages: tiles draw no maps, so there is no tile
 * I/O to keep away from the drawing.
 */
function addSummaryTilesPage({
  doc,
  root,
  baseline,
  postIntervention,
  siteName
}) {
  const section = doc.struct('Sect', { title: 'Summary' })
  root.add(section)

  addHeading(doc, section, siteName)

  let top = doc.y + SUMMARY_TILES_TOP_GAP
  const pageBottom = A4_PORTRAIT_HEIGHT - MARGIN

  for (const summary of summariseUnitTypes(baseline, postIntervention)) {
    // A section is never split across a page break: three tiles at the foot
    // of one page and two at the head of the next would read as two
    // different unit types.
    if (top + unitTypeSectionHeight() > pageBottom) {
      doc.addPage()
      top = MARGIN
    }
    section.add(buildUnitTypeSection({ doc, summary, top }))
    top += unitTypeSectionHeight() + TILE_SECTION_GAP
  }

  section.end()
}

/**
 * The project name as a caption over the heading, the way `govuk-caption-l`
 * sits over the H1 on the screen: the project identifies the summary, it is
 * not the summary's name.
 */
function addHeading(doc, section, siteName) {
  section.add(
    doc.struct('P', () => {
      doc.font(BODY).fontSize(FONT_SIZE.caption).fillColor(MUTED)
      doc.text(`${siteName} `, MARGIN, MARGIN, { width: CONTENT_WIDTH })
    })
  )

  section.add(
    doc.struct('H1', () => {
      doc.font(BOLD).fontSize(FONT_SIZE.title).fillColor(INK)
      doc.text('Summary ', { width: CONTENT_WIDTH })
    })
  )
}

/** The vertical space one unit-type section occupies, for pagination. */
function unitTypeSectionHeight() {
  return (
    SECTION_HEADING_HEIGHT +
    PRIMARY_TILE_HEIGHT +
    TILE_ROW_GAP +
    SECONDARY_TILE_HEIGHT
  )
}

function buildUnitTypeSection({ doc, summary, top }) {
  const heading = doc.struct('H2', () => {
    doc.font(BOLD).fontSize(FONT_SIZE.subHeading).fillColor(INK)
    doc.text(`${summary.title} `, MARGIN, top, { width: CONTENT_WIDTH })
  })

  const primaryTop = top + SECTION_HEADING_HEIGHT
  const secondaryTop = primaryTop + PRIMARY_TILE_HEIGHT + TILE_ROW_GAP

  // Each tile is a short list of elements (heading, value, maybe a tag), so
  // the two rows flatten into one reading-order sequence of children.
  const tiles = [
    ...primaryRow({ doc, summary, top: primaryTop }),
    ...secondaryRow({ doc, summary, top: secondaryTop })
  ].flat()

  return doc.struct('Sect', { title: summary.title }, [heading, ...tiles])
}

function primaryRow({ doc, summary, top }) {
  const width = tileWidth(PRIMARY_TILE_COUNT)

  const percentageTile = buildTile({
    doc,
    frame: tileFrame(0, top, width, PRIMARY_TILE_HEIGHT),
    heading: 'Total on-site net percentage change',
    value: summary.netPercentageChange,
    tag: tagFor(summary.status)
  })

  // The screen's tile is a link to the trading rules page. A PDF cannot take
  // the reader there, so the tile keeps the page's shape and wording without
  // pretending to be a link.
  const tradingRulesTile = buildTile({
    doc,
    frame: tileFrame(1, top, width, PRIMARY_TILE_HEIGHT),
    heading: 'Trading Rules',
    headingFont: BODY,
    headingSize: FONT_SIZE.tileValue,
    value: 'View trading rules in the service',
    valueSize: FONT_SIZE.body,
    valueColour: MUTED
  })

  return [percentageTile, tradingRulesTile]
}

/**
 * The Met / Not met tag — or no tag at all, where there is nothing to judge.
 *
 * `unit-summary.js` returns a null status whenever the percentage is not a
 * number it can assess. An untagged tile is a shape the design already has:
 * the screen renders its tag conditionally for the same reason, and a red
 * "Not met" beside a value reading "N/A" would claim the project was assessed
 * and fell short.
 */
function tagFor(status) {
  if (!status) {
    return null
  }
  return {
    label: status.text,
    colours: status.met ? TAG_COLOURS.met : TAG_COLOURS.notMet
  }
}

function secondaryRow({ doc, summary, top }) {
  const width = tileWidth(SECONDARY_TILE_COUNT)
  const cells = [
    { heading: 'On-site baseline', value: summary.baselineUnits },
    {
      heading: summary.postInterventionHeading,
      value: summary.postInterventionUnits
    },
    { heading: 'Total on-site net unit change', value: summary.netUnitChange }
  ]

  return cells.map((cell, index) =>
    buildTile({
      doc,
      frame: tileFrame(index, top, width, SECONDARY_TILE_HEIGHT),
      heading: cell.heading,
      value: cell.value
    })
  )
}

function tileWidth(count) {
  return (CONTENT_WIDTH - TILE_GUTTER * (count - 1)) / count
}

function tileFrame(index, top, width, height) {
  return { x: MARGIN + index * (width + TILE_GUTTER), y: top, width, height }
}

/**
 * One tile: a grey panel, a heading, the value below it, and optionally a
 * tag below that.
 *
 * The panel is an artifact and is drawn immediately — it has to sit under the
 * text, and it says nothing a reader needs. The text is returned as structure
 * elements in reading order, each at a position computed here.
 */
function buildTile({
  doc,
  frame,
  heading,
  value,
  tag = null,
  headingFont = BOLD,
  headingSize = FONT_SIZE.body,
  valueSize = FONT_SIZE.tileValue,
  valueColour = INK
}) {
  labelAsArtifact(doc, () => {
    doc.save()
    doc
      .rect(frame.x, frame.y, frame.width, frame.height)
      .fillColor(TILE_BACKGROUND)
      .fill()
    doc.restore()
  })

  const textX = frame.x + TILE_PADDING
  const textWidth = frame.width - TILE_PADDING * 2

  const headingY = frame.y + TILE_PADDING
  doc.font(headingFont).fontSize(headingSize)
  const headingHeight = doc.heightOfString(`${heading} `, { width: textWidth })

  const valueY = headingY + headingHeight + TILE_VALUE_GAP
  doc.font(BODY).fontSize(valueSize)
  const valueHeight = doc.heightOfString(`${value} `, { width: textWidth })

  const elements = [
    doc.struct('H3', () => {
      doc.font(headingFont).fontSize(headingSize).fillColor(INK)
      doc.text(`${heading} `, textX, headingY, { width: textWidth })
    }),
    doc.struct('P', () => {
      doc.font(BODY).fontSize(valueSize).fillColor(valueColour)
      doc.text(`${value} `, textX, valueY, { width: textWidth })
    })
  ]

  if (tag) {
    elements.push(
      buildTag(doc, tag, textX, valueY + valueHeight + TILE_VALUE_GAP)
    )
  }
  return elements
}

/**
 * The GOV.UK tag: short bold text on a coloured panel.
 *
 * The panel is an artifact; the label is real content. "Not met" has to reach
 * assistive technology as words — colour is never the only carrier.
 */
function buildTag(doc, { label, colours }, x, top) {
  doc.font(BOLD).fontSize(FONT_SIZE.tag)
  const textWidth = doc.widthOfString(label)
  const textHeight = doc.currentLineHeight()

  labelAsArtifact(doc, () => {
    doc.save()
    doc
      .rect(
        x,
        top,
        textWidth + TAG_PADDING_X * 2,
        textHeight + TAG_PADDING_Y * 2
      )
      .fillColor(colours.background)
      .fill()
    doc.restore()
  })

  return doc.struct('P', () => {
    doc.font(BOLD).fontSize(FONT_SIZE.tag).fillColor(colours.text)
    doc.text(`${label} `, x + TAG_PADDING_X, top + TAG_PADDING_Y, {
      width: textWidth + TAG_PADDING_X * 2,
      lineBreak: false
    })
  })
}

export { addSummaryTilesPage, unitTypeSectionHeight }
