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

/**
 * A tree's size is its size class's area, and the smallest is 0.0041 ha
 * (User Guide, Table 15). At a parcel's three decimals it would read 0.004,
 * and the screen shows 0.0041.
 */
const TREE_HECTARE_DECIMALS = 4

const HABITATS = Object.freeze({
  key: 'habitats',
  statsKey: 'habitats',
  title: 'Habitat parcels',
  heading: 'habitat parcels',
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
  // Each text column's width, as a fraction of the space the thumbnail column
  // leaves.
  columns: Object.freeze([
    { key: 'ref', label: 'Ref', fraction: 0.12 },
    { key: 'type', label: 'Habitat type', fraction: 0.4 },
    { key: 'condition', label: 'Condition', fraction: 0.26 },
    { key: 'area', label: 'Size (ha)', fraction: 0.22 }
  ])
})

const TREES = Object.freeze({
  key: 'trees',
  statsKey: 'trees',
  title: 'Individual trees',
  heading: 'individual trees',
  noun: 'tree',
  shown: 'its position among the habitat parcels',
  figure: 'Position of tree',
  surroundings: 'the habitat parcels',
  hectareDecimals: TREE_HECTARE_DECIMALS,
  // A point, drawn as the site maps draw a tree, on either side.
  style: () => HABITAT_STYLES.tree,
  columns: Object.freeze([
    { key: 'ref', label: 'Ref', fraction: 0.12 },
    { key: 'type', label: 'Habitat type', fraction: 0.26 },
    { key: 'treeSize', label: 'Tree size', fraction: 0.18 },
    { key: 'condition', label: 'Condition', fraction: 0.22 },
    { key: 'area', label: 'Size (ha)', fraction: 0.22 }
  ])
})

const LISTED_LAYERS = Object.freeze([HABITATS, TREES])

export { HABITATS, LISTED_LAYERS, TREES, TREE_HECTARE_DECIMALS }
