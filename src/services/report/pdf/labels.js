/**
 * The labels the pages share, in one place.
 *
 * The two document sides appear in the key-figures header, the map panel
 * captions, the legend and the habitat-page heading, and a report that called
 * the same side "Post-intervention" on one page and something else on another
 * would read as two different documents. The layer names have the same
 * problem, in a table on one page and in a sentence on another.
 */

const BASELINE = 'Baseline'
const POST_INTERVENTION = 'Post-intervention'

/**
 * The four feature layers, in the order every page presents them, with the
 * wording the service's own screens use. Keyed by the layer names
 * `db/project-geometry.js` reads and `site-data.js` joins.
 */
const LAYER_LABELS = Object.freeze({
  habitats: 'Area habitats',
  hedgerows: 'Hedgerows',
  watercourses: 'Watercourses',
  trees: 'Individual trees'
})

/**
 * The same layers named as countable things, for a sentence rather than a
 * table heading: "the first 500 of 1,240 habitat parcels".
 */
const LAYER_NOUNS = Object.freeze({
  habitats: 'habitat parcels',
  hedgerows: 'hedgerows',
  watercourses: 'watercourses',
  trees: 'individual trees'
})

export { BASELINE, LAYER_LABELS, LAYER_NOUNS, POST_INTERVENTION }
