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
import { buildSiteReportPdf } from './pdf/document.js'
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
 * @returns {Promise<{ pdf: Buffer, stats: object, siteName: string }>}
 */
async function buildSiteReport({
  drizzle,
  projectRow,
  osTiles = null,
  basemap = DEFAULT_BASEMAP
}) {
  const site = await readSiteData(drizzle, projectRow)
  const { grid, tileSource, attribution, attributionShort } =
    await resolveBasemap(osTiles, basemap)

  const { doc, stats } = await buildSiteReportPdf({
    baseline: site.baseline,
    postIntervention: site.postIntervention,
    grid,
    tileSource,
    attribution,
    attributionShort
  })

  return { pdf: await toBuffer(doc), stats, siteName: site.siteName }
}

/** The values the report route's `basemap` query parameter accepts. */
const BASEMAP_CHOICES = Object.freeze(Object.keys(BASEMAP_KINDS))

export { BASEMAP_CHOICES, DEFAULT_BASEMAP, buildSiteReport, toBuffer }
