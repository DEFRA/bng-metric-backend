/**
 * The legend and the basemap credit — the two blocks that close page 1.
 */

import { HABITAT_STYLES } from './map.js'
import { BODY, labelAsArtifact } from './page-furniture.js'
import {
  CONTENT_WIDTH,
  FONT_SIZE,
  LEGEND_HEIGHT,
  LEGEND_LINE_GAP,
  LEGEND_OPACITY,
  LEGEND_SWATCH,
  LEGEND_SWATCH_GAP,
  LEGEND_TOP_OFFSET,
  MARGIN,
  MUTED
} from './layout.js'

function buildLegend(doc, panels) {
  const entries = [
    ['Red line boundary', HABITAT_STYLES.redLine.stroke],
    ...panels.map((panel) => [`${panel.label} parcel`, panel.style.fill]),
    ['Hedgerow', HABITAT_STYLES.hedgerow.stroke],
    ['Watercourse', HABITAT_STYLES.watercourse.stroke]
  ]

  // Share the content width evenly so labels never collide, whatever the
  // number of entries (a post-intervention file adds one).
  const columnWidth = CONTENT_WIDTH / entries.length
  const top = doc.y

  labelAsArtifact(doc, () => {
    entries.forEach(([, colour], index) => {
      doc.save()
      doc
        .rect(
          MARGIN + index * columnWidth,
          top + LEGEND_TOP_OFFSET,
          LEGEND_SWATCH,
          LEGEND_SWATCH
        )
        .fillColor(colour)
        .fillOpacity(LEGEND_OPACITY)
        .fill()
      doc.restore()
    })
  })

  // The legend's meaning is carried by text, not only by the swatch colours —
  // colour alone must never be the sole carrier of information.
  return doc.struct('P', () => {
    doc.font(BODY).fontSize(FONT_SIZE.legend).fillColor(MUTED)
    entries.forEach(([label], index) => {
      doc.text(
        `${label} `,
        MARGIN + LEGEND_SWATCH + LEGEND_SWATCH_GAP + index * columnWidth,
        top + LEGEND_TOP_OFFSET,
        {
          width: columnWidth - LEGEND_SWATCH - LEGEND_SWATCH_GAP * 2,
          lineGap: LEGEND_LINE_GAP
        }
      )
    })
    doc.y = top + LEGEND_HEIGHT
  })
}

/**
 * The basemap credit, as a tagged paragraph.
 *
 * Every map already carries the credit burned into its bottom corner, but
 * those are artifacts — repeating the identical string on fifty thumbnails
 * would mean fifty interruptions for a screen-reader user. This is the one
 * place the wording enters the reading order, so it is written once, here,
 * where the maps it credits are.
 *
 * The wording arrives by configuration because it is OS's to dictate and has
 * not yet been confirmed with them — see the licensing questions on BMD-984.
 */
function buildAttribution(doc, attribution) {
  const top = doc.y
  return doc.struct('P', () => {
    doc.font(BODY).fontSize(FONT_SIZE.attribution).fillColor(MUTED)
    doc.text(`${attribution} `, MARGIN, top, { width: CONTENT_WIDTH })
  })
}

export { buildAttribution, buildLegend }
