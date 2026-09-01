/**
 * The pieces both page builders need: fonts, artifact marking, basemap
 * prefetch, and the ground a map is drawn on when there is no basemap.
 */

import path from 'node:path'

import { fetchTiles } from './map.js'
import { pickZoom } from './grid.js'
import {
  CREDIT_FONT_SIZE,
  CREDIT_FONT_STEP,
  CREDIT_INSET,
  CREDIT_LINE_HEIGHT,
  CREDIT_MIN_FONT_SIZE,
  CREDIT_PLATE_OPACITY,
  CREDIT_PLATE_PADDING,
  INK,
  MAP_GROUND,
  PAPER
} from './layout.js'

/**
 * Embed the body fonts.
 *
 * PDF/UA 7.21.4.1 requires every font PROGRAM to be embedded. pdfkit's
 * defaults — Helvetica and friends — are the PDF base-14: they are referenced
 * by name and resolved by the viewer, never embedded, so a document using them
 * can never pass however well tagged it is. Nothing about the rendered page
 * looks different either way; only a conformance checker can see it.
 *
 * Which typeface arrives here is decided at startup, not here — see
 * `services/report/fonts.js`. Noto Sans is what the repository can hold: it is
 * SIL OFL 1.1, so it is safe to commit. GOV.UK sets GDS Transport, which is
 * licensed to GDS under a bilateral agreement, is not redistributable, and so
 * reaches this function as buffers read from a private bucket instead.
 *
 * `pdfkit` takes a path or a buffer interchangeably, which is the whole reason
 * the two sources cost nothing to support: the bundled files stay the default
 * for every caller that passes no fonts at all — tests, and the CLI.
 */
const FONT_DIR = path.resolve(import.meta.dirname, '..', 'assets', 'fonts')
const BODY = 'Body'
const BOLD = 'Bold'

/**
 * @param {PDFDocument} doc
 * @param {{ regular: Buffer, bold: Buffer }|null} [fonts]  null uses the
 *   committed Noto Sans files
 */
function registerFonts(doc, fonts = null) {
  doc.registerFont(
    BODY,
    fonts?.regular ?? path.join(FONT_DIR, 'NotoSans-Regular.ttf')
  )
  doc.registerFont(
    BOLD,
    fonts?.bold ?? path.join(FONT_DIR, 'NotoSans-Bold.ttf')
  )
  // pdfkit starts every document on Helvetica; without this, anything drawn
  // before the first explicit font() call would reintroduce the failure.
  doc.font(BODY)
}

/**
 * Mark drawing as an artifact — decoration that carries no information and
 * must be skipped by assistive technology. Tagged PDF requires that all
 * non-structure content be marked this way.
 */
function labelAsArtifact(doc, draw) {
  doc.markContent('Artifact', { type: 'Layout' })
  draw()
  doc.endMarkedContent()
}

/**
 * Choose a zoom and fetch every tile the frame needs, BEFORE any drawing.
 *
 * Separated from drawing on purpose: pdfkit is sequential and stateful, so an
 * `await` between marking a structure sequence and closing it lets other work
 * interleave and silently corrupts both the layout and the reading order.
 *
 * @returns {Promise<{ z: number, tiles: Map<string, {png: Buffer}> }>}
 */
async function prepareBasemap({
  grid,
  extent,
  tileSource,
  frameWidth,
  targetDpi
}) {
  const z = pickZoom(grid, extent, frameWidth, targetDpi)
  const { tiles } = await fetchTiles(grid, z, extent, tileSource)
  return { z, tiles }
}

/**
 * The largest credit that fits inside a map frame, or null if none does.
 *
 * Called BEFORE the basemap is drawn, not after, because the answer decides
 * whether there is a basemap at all: this renderer draws no OS mapping into a
 * frame it cannot credit. That makes the licensing claim true by construction
 * rather than by everyone remembering to pass the wording down.
 *
 * The wordings are tried in order — the full statement first, the short form
 * second — and each is shrunk to CREDIT_MIN_FONT_SIZE before the next is
 * tried. A site map is wide enough for the whole sentence; an 18 mm thumbnail
 * is not, at any legible size, which is the only reason the short form exists.
 *
 * @param {object} doc
 * @param {{width: number}} frame
 * @param {Array<string|null>} wordings  most preferred first
 * @returns {{text: string, size: number, width: number}|null}
 */
function fitCredit(doc, frame, wordings) {
  const available = frame.width - (CREDIT_INSET + CREDIT_PLATE_PADDING) * 2
  doc.font(BODY)

  for (const text of wordings.filter(Boolean)) {
    for (
      let size = CREDIT_FONT_SIZE;
      size >= CREDIT_MIN_FONT_SIZE;
      size -= CREDIT_FONT_STEP
    ) {
      doc.fontSize(size)
      const width = doc.widthOfString(text)
      if (width <= available) {
        return { text, size, width }
      }
    }
  }
  return null
}

/**
 * Burn a credit into the bottom-right corner of a map frame.
 *
 * Bottom RIGHT because the scale bar has the bottom left. On a translucent
 * plate because the credit sits over live mapping whose tone is not knowable
 * in advance — grey text on a grey roof is not a credit either.
 *
 * The caller marks this as an artifact. That is deliberate: the identical
 * string on fifty thumbnails would be announced fifty times, so the reading
 * order gets the wording once, from the tagged paragraph `buildAttribution`
 * writes, and every map carries it visually.
 *
 * @param {object} doc
 * @param {{x: number, y: number, width: number, height: number}} frame
 * @param {{text: string, size: number, width: number}} credit  from fitCredit
 */
function drawCredit(doc, frame, credit) {
  const height = credit.size * CREDIT_LINE_HEIGHT
  const x = frame.x + frame.width - CREDIT_INSET - credit.width
  const y = frame.y + frame.height - CREDIT_INSET - height

  doc.save()
  doc
    .rect(
      x - CREDIT_PLATE_PADDING,
      y - CREDIT_PLATE_PADDING,
      credit.width + CREDIT_PLATE_PADDING * 2,
      height + CREDIT_PLATE_PADDING * 2
    )
    .fillColor(PAPER)
    .fillOpacity(CREDIT_PLATE_OPACITY)
    .fill()
  doc.restore()

  doc.save()
  doc.font(BODY).fontSize(credit.size).fillColor(INK)
  doc.text(`${credit.text} `, x, y, { lineBreak: false })
  doc.restore()
}

/** The plain ground a map frame gets when there is no basemap behind it. */
function fillGround(doc, frame) {
  doc.save()
  doc.rect(frame.x, frame.y, frame.width, frame.height).fillColor(MAP_GROUND)
  doc.fill()
  doc.restore()
}

/**
 * "1 watercourse", not "1 watercourses".
 *
 * Trivial, and worth doing properly: this string is not decoration, it is what
 * a screen-reader user actually hears in place of the map. Automated
 * conformance checking cannot catch it — veraPDF confirms alt text EXISTS, not
 * that it reads well — which is precisely why a human pass is still required.
 */
function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export {
  BODY,
  BOLD,
  drawCredit,
  fillGround,
  fitCredit,
  labelAsArtifact,
  plural,
  prepareBasemap,
  registerFonts
}
