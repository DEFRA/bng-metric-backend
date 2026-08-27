/**
 * The PDF itself: a tagged, PDF/UA-targeted site report.
 *
 * Structure of the output:
 *   Page 1  site heading, key figures (pdfkit's built-in tagged table),
 *           baseline and post-intervention site maps side by side, legend
 *   Page 2+ one row per habitat parcel: mini-map, ref, type, condition, size
 *
 * This module owns only the document: its metadata, its fonts and the order of
 * its pages. The two pages build themselves — `summary-page.js` and
 * `habitat-pages.js` — and share their geometry through `layout.js`, so a
 * typographic decision is made once and a page's structure reads on its own.
 *
 * Numbers come from the project document, never from the geometry. The
 * document's `sizeSquareMetres` / `sizeMetres` are what the service shows on
 * screen and what the unit calculation ran on; recomputing them here would give
 * the report a second opinion, and a report that disagrees with the page it was
 * generated from is worse than no report.
 */

import PDFDocument from 'pdfkit'

import { addHabitatPages } from './habitat-pages.js'
import { addSummaryPage } from './summary-page.js'
import { plural, registerFonts } from './page-furniture.js'
import { A4_PORTRAIT, MARGIN } from './layout.js'

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
 * @param {string} [options.attribution]          burned into the page; see summary-page.js
 * @param {boolean} [options.graticule]           registration overlay, for diagnosis
 * @param {boolean} [options.habitatBasemap]      basemap behind each thumbnail
 * @returns {Promise<{ doc: PDFDocument, stats: object }>}
 */
async function buildSiteReportPdf({
  baseline,
  postIntervention = null,
  grid = null,
  tileSource = null,
  attribution = null,
  graticule = false,
  habitatBasemap = true
}) {
  const siteName = baseline.siteName ?? DEFAULT_SITE_NAME
  const basemap = Boolean(grid && tileSource)
  const doc = createDocument(siteName)

  registerFonts(doc)

  const stats = { maps: 0, tiles: 0, habitats: 0, zooms: [] }
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
    stats
  }

  await addSummaryPage({ ...context, graticule, siteName })
  await addHabitatPages({
    ...context,
    withBasemap: basemap && habitatBasemap
  })

  root.end()
  return { doc, stats }
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

export { buildSiteReportPdf, plural }
