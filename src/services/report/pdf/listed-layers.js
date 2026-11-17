/**
 * The layers the report lists one feature at a time, after the site maps, and
 * what each says about itself.
 *
 * Habitat parcels first, then individual trees. A tree is an area habitat in
 * the metric, priced and summed with the parcels, so a report that listed the
 * parcels and left the trees out would leave part of the area habitat units
 * with nothing on the page to account for them.
 *
 * Both layouts, table and cards, list the same layers in the same order from
 * this one description, so the two cannot drift apart on what they cover.
 */

import { HABITAT_STYLES } from './map.js'
import { PARCEL_HECTARE_DECIMALS } from './layout.js'
import { LAYER_LABELS, LAYER_NOUNS } from './labels.js'

/**
 * A tree's size is its size class's area, and the smallest is 0.0041 ha
 * (User Guide, Table 15). At a parcel's three decimals it would read 0.004,
 * and the screen shows 0.0041.
 */
const TREE_HECTARE_DECIMALS = 4

/** The column headings, so a column two layers share is named the same in both. */
const COLUMN_LABELS = Object.freeze({
  ref: 'Ref',
  type: 'Habitat type',
  treeSize: 'Tree size',
  treeCount: 'Number of trees',
  condition: 'Condition',
  area: 'Size (ha)'
})

/**
 * A text column, its width a fraction of the space the thumbnail column
 * leaves. Each layer's fractions sum to one.
 */
function column(key, fraction) {
  return Object.freeze({ key, label: COLUMN_LABELS[key], fraction })
}

const HABITATS = Object.freeze({
  key: 'habitats',
  title: 'Habitat parcels',
  heading: LAYER_NOUNS.habitats,
  noun: 'parcel',
  shown: 'its shape and position among the neighbouring parcels',
  figure: 'Outline of parcel',
  surroundings: 'the neighbouring parcels',
  hectareDecimals: PARCEL_HECTARE_DECIMALS,
  // A parcel's fill says which side of the project the report is listing.
  style: (postIntervention) =>
    postIntervention
      ? HABITAT_STYLES.postIntervention
      : HABITAT_STYLES.baseline,
  columns: Object.freeze([
    column('ref', 0.12),
    column('type', 0.4),
    column('condition', 0.26),
    column('area', 0.22)
  ])
})

/**
 * A tree point is one tree in the BNG Service template, but in the legacy
 * template its Count can make it several, and its size is then its size
 * class's area times that count. So a tree's row gives the number of trees
 * beside the size class, as the tree details screens do, or a reader could not
 * tell why a Small tree measures 0.0123 ha.
 */
const TREES = Object.freeze({
  key: 'trees',
  title: LAYER_LABELS.trees,
  heading: LAYER_NOUNS.trees,
  noun: 'tree',
  shown: 'its position among the habitat parcels',
  figure: 'Position of tree',
  surroundings: 'the habitat parcels',
  hectareDecimals: TREE_HECTARE_DECIMALS,
  // A point, drawn as the site maps draw a tree, on either side.
  style: () => HABITAT_STYLES.tree,
  columns: Object.freeze([
    column('ref', 0.1),
    column('type', 0.18),
    column('treeSize', 0.15),
    // Wide enough for its heading on one line: "Number of trees" wraps
    // through the header rule at a narrower width.
    column('treeCount', 0.2),
    column('condition', 0.18),
    column('area', 0.19)
  ])
})

const LISTED_LAYERS = Object.freeze([HABITATS, TREES])

export { HABITATS, LISTED_LAYERS, TREES, TREE_HECTARE_DECIMALS }
