/**
 * What the two habitat layouts share about listing a layer: which side it is
 * listed from, the section, heading and introduction it opens with, and the
 * thumbnails its features are drawn with.
 *
 * The table and the card layout differ in how they present each feature, not
 * in which features they present or how a section begins, so that part lives
 * here once (see listed-layers.js for what each layer says about itself).
 */

import { BODY, BOLD, fitCredit } from './page-furniture.js'
import { prepareThumbnails } from './thumbnail.js'
import { CONTENT_WIDTH, FONT_SIZE, INK, MARGIN, MUTED } from './layout.js'
import { BASELINE, POST_INTERVENTION } from './labels.js'
import { LISTED_LAYERS } from './listed-layers.js'

/**
 * Add every listed layer, one after another.
 *
 * In turn, never concurrently: each layer draws into the one pdfkit document,
 * whose drawing is sequential and stateful, so the next layer must not start
 * until the last has finished drawing.
 *
 * @param {object} context  the document context buildSiteReportPdf builds
 * @param {(context: object, layer: object) => Promise<void>} addLayer
 */
async function addListedLayers(context, addLayer) {
  await LISTED_LAYERS.reduce(
    (previous, layer) => previous.then(() => addLayer(context, layer)),
    Promise.resolve()
  )
}

/**
 * Open a layer's section on a new page, with its H2 and the layout's
 * introduction, and fetch every thumbnail's tiles before any row is drawn.
 *
 * The side is the post-intervention one where the project has it, as the site
 * is listed as it will be. A side with none of the layer gets no section at
 * all: an empty one announcing features that are not there is worse than none.
 *
 * @param {object} context
 * @param {object} layer  one of LISTED_LAYERS
 * @param {object} options
 * @param {string} options.introduction  the paragraph under the heading
 * @param {object} options.frame    a thumbnail frame, which is the same size
 *                                  wherever on the page it lands
 * @returns {Promise<{ site: object, features: Array, section: object,
 *   style: object, credit: object|null, thumbnails: Map } | null>}
 */
async function openLayerSection(context, layer, { introduction, frame }) {
  const { doc, grid, tileSource, withBasemap, attribution, attributionShort } =
    context
  const opened = openSection(context, layer, introduction)
  if (!opened) {
    return null
  }

  // Every thumbnail frame is the same square, so one measurement settles the
  // credit for all of them — and, because no OS mapping is drawn into a frame
  // that cannot carry its credit, settles whether they get a basemap at all.
  const credit = withBasemap
    ? fitCredit(doc, frame, [attribution, attributionShort])
    : null

  // Prefetch every thumbnail's tiles before drawing starts. A frame is always
  // the same size, so its extent — and therefore its tile set — does not
  // depend on where the feature lands on the page.
  const thumbnails = await prepareThumbnails({
    features: opened.features,
    grid,
    tileSource,
    withBasemap: Boolean(credit),
    size: frame.width
  })

  return { ...opened, credit, thumbnails }
}

function openSection(
  { doc, root, baseline, postIntervention },
  layer,
  introduction
) {
  const site = postIntervention ?? baseline
  const features = site.layers[layer.key] ?? []
  if (features.length === 0) {
    return null
  }

  const label = postIntervention ? POST_INTERVENTION : BASELINE
  const section = doc.struct('Sect', { title: layer.title })
  root.add(section)

  doc.addPage()
  section.add(
    doc.struct('H2', () => {
      doc.font(BOLD).fontSize(FONT_SIZE.sectionHeading).fillColor(INK)
      doc.text(`${label} ${layer.heading} `, MARGIN, MARGIN, {
        width: CONTENT_WIDTH
      })
    })
  )
  section.add(
    doc.struct('P', () => {
      doc.font(BODY).fontSize(FONT_SIZE.bodySmall).fillColor(MUTED)
      doc.text(introduction, { width: CONTENT_WIDTH })
    })
  )

  return {
    site,
    features,
    section,
    style: layer.style(Boolean(postIntervention))
  }
}

export { addListedLayers, openLayerSection }
