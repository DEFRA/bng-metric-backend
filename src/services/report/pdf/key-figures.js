/**
 * The key-figures table on page 1: one row per habitat layer, plus the
 * headline biodiversity-units total, baseline against post-intervention.
 *
 * Every figure is the project document's own. Nothing here is derived from
 * geometry, so the table cannot disagree with the screens the report was
 * generated from.
 */

import { BODY, BOLD, plural } from './page-furniture.js'
import {
  BORDER,
  FONT_SIZE,
  HECTARE_DECIMALS,
  INK,
  KEY_FIGURES_COLUMN_WIDTH,
  RULE_WIDTH,
  SQ_M_PER_HECTARE,
  UNIT_DECIMALS
} from './layout.js'
import { BASELINE, POST_INTERVENTION } from './labels.js'

const LAYER_LABELS = {
  habitats: 'Area habitats',
  hedgerows: 'Hedgerows',
  watercourses: 'Watercourses',
  trees: 'Individual trees'
}

const NOT_SUPPLIED = 'Not supplied'

function addKeyFiguresTable(doc, section, baseline, postIntervention) {
  const rows = [
    ['Measure', BASELINE, POST_INTERVENTION],
    ...Object.keys(LAYER_LABELS).map((role) => [
      LAYER_LABELS[role],
      describeLayer(baseline, role),
      postIntervention ? describeLayer(postIntervention, role) : NOT_SUPPLIED
    ]),
    [
      'Biodiversity units',
      describeUnits(baseline),
      postIntervention ? describeUnits(postIntervention) : NOT_SUPPLIED
    ]
  ]

  // pdfkit's built-in table generation (added in 0.17.0).
  //
  // `structParent` is what makes it accessible, and it is easy to get wrong:
  // pdfkit's table builds its OWN Table/TR/TH/TD structure and attaches it to
  // the element given here. Wrapping the call in `doc.struct('Table', () => …)`
  // instead looks right and renders identically, but emits a Table element
  // containing no rows at all — the cells become one undifferentiated marked
  // content sequence. Verified by counting /S /TD in the output.
  doc.font(BODY).fontSize(FONT_SIZE.body).fillColor(INK)
  doc.table({
    structParent: section,
    columnStyles: ['*', KEY_FIGURES_COLUMN_WIDTH, KEY_FIGURES_COLUMN_WIDTH],
    rowStyles: (index) =>
      index === 0
        ? {
            border: [0, 0, RULE_WIDTH.keyFiguresHeader, 0],
            borderColor: INK,
            font: BOLD
          }
        : { border: [0, 0, RULE_WIDTH.keyFiguresRow, 0], borderColor: BORDER },
    // `type` and `scope` are pdfkit's accessibility hooks for tables. Scope is
    // undocumented but supported ('Row' | 'Column' | 'Both'), and setting it
    // also makes pdfkit emit a /Headers array linking each data cell to the
    // headers that describe it — which is what a screen reader announces.
    data: rows.map((row, rowIndex) =>
      row.map((cell, columnIndex) => ({
        text: `${cell} `,
        ...headerRole(rowIndex, columnIndex)
      }))
    )
  })
}

/** Column headers scope down their column; the stub column scopes its row. */
function headerRole(rowIndex, columnIndex) {
  if (rowIndex === 0) {
    return { type: 'TH', scope: 'Column' }
  }
  if (columnIndex === 0) {
    return { type: 'TH', scope: 'Row' }
  }
  return { type: 'TD' }
}

function describeLayer(site, role) {
  const features = site.layers[role] ?? []
  if (features.length === 0) {
    return 'None'
  }
  if (role === 'habitats') {
    const sqm = sumBy(
      features,
      (feature) => feature.properties.sizeSquareMetres
    )
    const hectares = (sqm / SQ_M_PER_HECTARE).toFixed(HECTARE_DECIMALS)
    return `${features.length} parcels, ${hectares} ha`
  }
  if (role === 'trees') {
    return plural(features.length, 'tree')
  }
  const metres = sumBy(features, (feature) => feature.properties.sizeMetres)
  return `${plural(features.length, 'feature')} (${Math.round(metres)} m)`
}

function sumBy(features, read) {
  return features.reduce((total, feature) => total + (read(feature) ?? 0), 0)
}

/**
 * The headline number, taken verbatim from the units the service calculated.
 * Area habitats and individual trees are both "area" units and are summed the
 * same way the summary screen sums them.
 */
function describeUnits(site) {
  const units = site.units
  const total = [
    units?.habitatsTotal,
    units?.treesTotal,
    units?.hedgerowsTotal,
    units?.watercoursesTotal
  ].reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0)
  return `${total.toFixed(UNIT_DECIMALS)} units`
}

export { addKeyFiguresTable }
