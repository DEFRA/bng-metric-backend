/**
 * Generating a site report PDF for one project.
 *
 * Three steps, in this order and no other:
 *
 *   1. read the site (document attributes + PostGIS geometry)
 *   2. fetch every basemap tile the document will need
 *   3. draw
 *
 * Step 2 finishing before step 3 starts is not an optimisation, it is a
 * correctness requirement — pdfkit's drawing is sequential and stateful, and an
 * `await` in the middle of it lets other work interleave and silently corrupts
 * both the layout and the tagged reading order. `document.js` keeps the two
 * apart; this module just has to not undo it.
 */

import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import {
  DEFAULT_LAYOUT,
  HABITAT_LAYOUTS,
  buildSiteReportPdf
} from './pdf/document.js'
import { isOsTileError } from '../os-tiles/errors.js'
import { osTileSource, osVectorTileSource } from './pdf/tile-source.js'
import { readSiteData } from './site-data.js'

const logger = createLogger()

/**
 * Collect a pdfkit document into a Buffer.
 *
 * The whole document is held in memory rather than streamed to the response.
 * That is a defensible trade at this size — the largest example site is a
 * 12-page, sub-megabyte document that builds in well under a second — and it
 * buys a definite `content-length`, which is what lets a browser show download
 * progress. If report sizes ever grow past a few megabytes, streaming is the
 * change to make.
 *
 * What keeps "this size" true is `report.maxFeaturesPerLayer`: the geometry
 * read is capped per layer, so the document a pathological project produces is
 * bounded rather than as large as its uploads. See `db/project-geometry.js`.
 */
function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.end()
  })
}

/** "Draw the geometry on a plain ground." */
const NO_BASEMAP = Object.freeze({
  grid: null,
  tileSource: null,
  attribution: null,
  attributionShort: null
})

/**
 * The two basemap flavours a request can choose between.
 *
 * They need DIFFERENT OS Data Hub products on the key — "OS NGD API – Tiles"
 * for vector, "OS Maps API" for raster — and a key may hold either, so the
 * choice is per-request rather than per-deployment (see the report route's
 * `basemap` query parameter). Vector is the default: it is the product the
 * project's key holds, it has shown no plan zoom ceiling, and being drawn as
 * geometry it stays crisp at any print size.
 */
const BASEMAP_KINDS = Object.freeze({
  vector: {
    grid: (osTiles) => osTiles.getPublishedVectorGrid(),
    tileSource: osVectorTileSource
  },
  raster: {
    grid: (osTiles) => osTiles.getPublishedGrid(),
    tileSource: osTileSource
  }
})

const DEFAULT_BASEMAP = 'vector'

/**
 * Resolve the basemap for this request.
 *
 * A basemap is drawn whenever this service holds an OS key — there is no
 * separate switch. The credit travels with it and is burned into the bottom
 * corner of every map the report draws, which is what makes the mapping
 * publishable in a document that can be forwarded.
 *
 * That covers attribution. It does not settle whether OS permit their mapping
 * to be EMBEDDED in a downloadable PDF at all, which is a different question
 * from displaying it in a browser and one only OS can answer — see
 * `docs/site-report.md`. Until it is answered, the lever is the key: no key,
 * no tiles, no OS mapping in the document.
 *
 * A basemap failure degrades to no basemap. A report with a plain ground is
 * still a correct, useful report; refusing to produce one because Ordnance
 * Survey is unreachable would turn a cosmetic dependency into an outage.
 */
async function resolveBasemap(osTiles, basemap) {
  if (!osTiles) {
    return NO_BASEMAP
  }

  const kind = BASEMAP_KINDS[basemap] ?? BASEMAP_KINDS[DEFAULT_BASEMAP]
  try {
    return {
      grid: await kind.grid(osTiles),
      tileSource: kind.tileSource(osTiles),
      attribution: config.get('osMaps.attribution'),
      attributionShort: config.get('osMaps.attributionShort')
    }
  } catch (error) {
    logger.warn(
      `Site report ${basemap} basemap unavailable, rendering without it: ${error.message}`
    )
    return NO_BASEMAP
  }
}

/**
 * @param {object} options
 * @param {object} options.drizzle
 * @param {{ id: string, project: object }} options.projectRow
 * @param {object|null} [options.osTiles]  the OS tiles service, when configured
 * @param {'vector'|'raster'} [options.basemap]  which basemap flavour to draw
 * @param {'table'|'cards'} [options.layout]  how habitat parcels are presented
 * @param {{regular: Buffer, bold: Buffer}|null} [options.fonts]  the fonts
 *        resolved at startup by plugins/report-fonts.js
 * @returns {Promise<{ pdf: Buffer, stats: object, siteName: string }>}
 */
async function buildSiteReport({
  drizzle,
  projectRow,
  osTiles = null,
  basemap = DEFAULT_BASEMAP,
  fonts = null,
  layout = DEFAULT_LAYOUT
}) {
  const site = await readSiteData(drizzle, projectRow)
  const using = await resolveBasemap(osTiles, basemap)
  const { doc, stats } = await drawDegradingToPlainGround(site, using, {
    fonts,
    layout,
    basemap
  })

  return { pdf: await toBuffer(doc), stats, siteName: site.siteName }
}

function draw(site, using, { fonts, layout }) {
  return buildSiteReportPdf({
    baseline: site.baseline,
    postIntervention: site.postIntervention,
    grid: using.grid,
    tileSource: using.tileSource,
    attribution: using.attribution,
    attributionShort: using.attributionShort,
    fonts,
    layout
  })
}

/**
 * Draw the document — and draw it again on a plain ground if Ordnance Survey
 * fails part-way through.
 *
 * `resolveBasemap` only covers OS failing BEFORE any drawing starts. A tile
 * that times out, 5xxs or arrives unreadable gets here instead, once the
 * document is already half written, and the request has by then committed to
 * producing a report. Failing it over a picture would be the outage
 * `resolveBasemap` exists to avoid, arriving through the other door.
 *
 * Only for tile failures (`isOsTileError`), and only when OS tiles were in use
 * at all: anything else is a fault in the drawing, and a renderer bug hidden
 * behind a substituted basemap is a bug nobody ever finds. The document is
 * rebuilt from scratch because a half-written PDF cannot have its basemap
 * swapped, and one drawn half on OS tiles and half on a plain ground would be
 * worse than either.
 *
 * Ported from the digital prototype's `buildReport`
 * (`app/routes/pdf-report.js`), which the report engine is shared with.
 */
async function drawDegradingToPlainGround(site, using, options) {
  try {
    return await draw(site, using, options)
  } catch (error) {
    if (!using.tileSource || !isOsTileError(error)) {
      throw error
    }

    logger.warn(
      `Site report ${options.basemap} basemap failed mid-render, redrawing ` +
        `without it: ${error.message}`
    )
    const built = await draw(site, NO_BASEMAP, options)
    return { ...built, stats: { ...built.stats, basemapDegraded: true } }
  }
}

/** The values the report route's `basemap` query parameter accepts. */
const BASEMAP_CHOICES = Object.freeze(Object.keys(BASEMAP_KINDS))

/** The values the report route's `layout` query parameter accepts. */
const LAYOUT_CHOICES = Object.freeze(Object.keys(HABITAT_LAYOUTS))

export {
  BASEMAP_CHOICES,
  DEFAULT_BASEMAP,
  DEFAULT_LAYOUT,
  LAYOUT_CHOICES,
  buildSiteReport,
  toBuffer
}
