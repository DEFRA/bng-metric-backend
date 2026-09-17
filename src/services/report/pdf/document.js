/**
 * The PDF itself: a tagged, PDF/UA-targeted site report.
 *
 * Structure of the output:
 *   Page 1  the summary, laid out like the service's project summary screen:
 *           the project name over a "Summary" heading, then one tile section
 *           per unit type carrying the net percentage change and its Met /
 *           Not met tag, the trading rules, and the baseline,
 *           post-intervention and net unit change figures
 *   Page 2  key figures (pdfkit's built-in tagged table), then the baseline
 *           and post-intervention site maps side by side, and the legend
 *   Page 3+ one row (or one card) per habitat parcel: mini-map, ref, type,
 *           condition, size
 *
 * This module owns only the document: its metadata, its fonts and the order of
 * its pages. The pages build themselves — `summary-tiles.js`,
 * `summary-page.js` and `habitat-pages.js` — and share their geometry through
 * `layout.js`, so a typographic decision is made once and a page's structure
 * reads on its own.
 *
 * Numbers come from the project document, never from the geometry. The
 * document's `sizeSquareMetres` / `sizeMetres` are what the service shows on
 * screen and what the unit calculation ran on; recomputing them here would give
 * the report a second opinion, and a report that disagrees with the page it was
 * generated from is worse than no report.
 */

import PDFDocument from 'pdfkit'

import { addHabitatCards } from './habitat-cards.js'
import { addHabitatPages } from './habitat-pages.js'
import { addSummaryPage } from './summary-page.js'
import { addSummaryTilesPage } from './summary-tiles.js'
import { registerFonts } from './page-furniture.js'
import { A4_PORTRAIT, MARGIN } from './layout.js'

/**
 * How the habitat parcels are presented. A table fits more parcels per page; a
 * card carries more attributes per parcel, because each one gets a line rather
 * than a column. See habitat-cards.js.
 */
const HABITAT_LAYOUTS = Object.freeze({
  table: addHabitatPages,
  cards: addHabitatCards
})
const DEFAULT_LAYOUT = 'table'

const PDF_VERSION = '1.5'
const DEFAULT_SITE_NAME = 'BNG site'

/**
 * Build the report.
 *
 * @param {object} options
 * @param {object} options.baseline               site model from site-data.js
 * @param {object|null} [options.postIntervention]
 * @param {object|null} [options.grid]            tile matrix set; null with no basemap
 * @param {Function|null} [options.tileSource]    null means no basemap
 * @param {string} [options.attribution]          credit burned into every map
 * @param {string} [options.attributionShort]     credit for frames too small for the full wording
 * @param {boolean} [options.graticule]           registration overlay, for diagnosis
 * @param {boolean} [options.habitatBasemap]      basemap behind each thumbnail
 * @param {'table'|'cards'} [options.layout]     habitat parcel presentation
 * @param {{regular: Buffer, bold: Buffer}|null} [options.fonts]  embedded
 *        typeface, resolved at startup; null uses the committed Noto Sans
 * @returns {Promise<{ doc: PDFDocument, stats: object }>}
 */
async function buildSiteReportPdf({
  baseline,
  postIntervention = null,
  grid = null,
  tileSource = null,
  attribution = null,
  attributionShort = null,
  graticule = false,
  habitatBasemap = true,
  fonts = null,
  layout = DEFAULT_LAYOUT
}) {
  const siteName = baseline.siteName ?? DEFAULT_SITE_NAME
  const basemap = Boolean(grid && tileSource)
  const doc = createDocument(siteName)

  registerFonts(doc, fonts)

  const stats = {
    maps: 0,
    tiles: 0,
    habitats: 0,
    zooms: [],
    capped: cappedStats(baseline, postIntervention)
  }
  const root = doc.struct('Document', { title: documentTitle(siteName) })
  doc.addStructure(root)

  const context = {
    doc,
    root,
    baseline,
    postIntervention,
    grid,
    tileSource,
    basemap,
    attribution,
    attributionShort,
    stats
  }

  addSummaryTilesPage({ ...context, siteName })
  await addSummaryPage({ ...context, graticule, siteName })
  const addHabitats = HABITAT_LAYOUTS[layout] ?? HABITAT_LAYOUTS[DEFAULT_LAYOUT]
  await addHabitats({
    ...context,
    withBasemap: basemap && habitatBasemap
  })

  root.end()
  return { doc, stats }
}

/**
 * Which layers the geometry read capped, carried into the stats so the
 * request log records a partial report as partial. The document itself says
 * so on its first page — see `addCappedNote` in summary-page.js.
 */
function cappedStats(baseline, postIntervention) {
  return [
    ...(baseline?.capped ?? []).map((entry) => ({
      side: 'baseline',
      ...entry
    })),
    ...(postIntervention?.capped ?? []).map((entry) => ({
      side: 'postIntervention',
      ...entry
    }))
  ]
}

function documentTitle(siteName) {
  return `Biodiversity net gain site report — ${siteName}`
}

function createDocument(siteName) {
  return new PDFDocument({
    size: A4_PORTRAIT,
    margin: MARGIN,
    // PDF/UA checklist, from pdfkit's accessibility docs.
    pdfVersion: PDF_VERSION,
    subset: 'PDF/UA',
    tagged: true,
    displayTitle: true,
    lang: 'en-GB',
    info: {
      Title: documentTitle(siteName),
      Author: 'Defra — Biodiversity Net Gain service',
      Subject: 'Site report with baseline and post-intervention habitat mapping'
    }
  })
}

export { DEFAULT_LAYOUT, HABITAT_LAYOUTS, buildSiteReportPdf }
export { plural } from './page-furniture.js'
