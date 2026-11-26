import { MAX_YEARS, MAX_YEARS_PLUS, OVER_MAX_YEARS } from 'bng-library/metric'
import { WORKBOOK_SPELLINGS } from 'bng-library/workbook-writer'

import {
  RETENTION_CREATED,
  RETENTION_ENHANCED,
  RETENTION_RETAINED,
  isLegacyLostLinear,
  resolveRetentionCategory
} from '../../utilities/enrichment/post-intervention/retention-category.js'
import { isTemplateUpload } from '../../utilities/enrichment/post-intervention/lineage-outcomes.js'

/**
 * A project's on-site features as the Statutory Biodiversity Metric's input
 * rows (BMD-1141), keyed as bng-library's METRIC_SHEETS, for
 * writeMetricWorkbook to fill a copy of the metric with.
 *
 * Each baseline feature is one row on its baseline sheet, placed by the
 * post-intervention features that carry it forward:
 *
 * - A template upload links each to its parent by `parentFeatureId`; a legacy
 *   upload, whose file holds both stages on one row, by its ref.
 * - Retained or Enhanced, whole, it is retained or enhanced by its own size.
 *   A template watercourse Enhanced whole is enhanced by its length as drawn,
 *   and a template hedgerow, or a feature kept in several parts, by its
 *   parts' sizes, as bng-library's own BNG Service reader places them.
 * - What nothing carries forward is lost.
 * - Every Created feature is a creation row, a legacy area habitat's Lost
 *   included, as the service stores it Created. A legacy hedgerow or
 *   watercourse marked Lost is not: it reads as Created, but the service
 *   counts it as lost, with no units, and so does the workbook.
 *
 * The service prices every baseline habitat, and every retained one, at Low
 * strategic significance (Defra's guidance, BMD-315), so baseline rows carry
 * the metric's Low wording whatever the file said, and the metric's answers
 * agree with the service's. The service treats every feature as on-site, so
 * the off-site sheets are left empty.
 */

const SQUARE_METRES_PER_HECTARE = 10_000
const METRES_PER_KM = 1000
const INDIVIDUAL_TREES = 'Individual trees'

// The metric's drop-down wording for each strategic significance category.
const SIGNIFICANCE_WORDING = Object.freeze({
  Low: 'Area/compensation not in local strategy/ no local strategy',
  Medium: 'Location ecologically desirable but not in local strategy',
  High: 'Formally identified in local strategy'
})
const BASELINE_SIGNIFICANCE = SIGNIFICANCE_WORDING.Low

const KEPT = new Set([RETENTION_RETAINED, RETENTION_ENHANCED])

const hectares = (feature) =>
  feature?.sizeSquareMetres == null
    ? null
    : feature.sizeSquareMetres / SQUARE_METRES_PER_HECTARE
const kilometres = (feature) =>
  feature?.sizeMetres == null ? null : feature.sizeMetres / METRES_PER_KM

const significance = (value) => SIGNIFICANCE_WORDING[value] ?? value ?? null

/**
 * Years in advance or delay as the metric's list holds them. The service
 * stores "30+" as 30, flagged `<field>Is30Plus`, and none as null, which the
 * metric reads as 0.
 */
function years(proposed, field) {
  const value = proposed[field]
  if (value === MAX_YEARS && proposed[`${field}Is30Plus`]) {
    return MAX_YEARS_PLUS
  }
  if (value === OVER_MAX_YEARS) {
    return MAX_YEARS_PLUS
  }
  return value ?? 0
}

const riparian = (value) =>
  WORKBOOK_SPELLINGS.riparianEncroachment[value] ?? value ?? null

/** Each side's habitat columns for an area habitat, tree or vertical one. */
function areaColumns({ tree = false } = {}) {
  return {
    baseline: (feature) => ({
      broadHabitat: tree ? INDIVIDUAL_TREES : (feature.broadType ?? null),
      habitatType: feature.type ?? null,
      irreplaceable: feature.irreplaceable ? 'Yes' : 'No',
      size: hectares(feature)
    }),
    proposed: (feature) => ({
      broadHabitat: tree
        ? INDIVIDUAL_TREES
        : (feature.proposed?.broadType ?? null),
      habitatType: feature.proposed?.type ?? null,
      size: hectares(feature)
    })
  }
}

function linearColumns({ encroachment = false } = {}) {
  const encroachments = (side) =>
    encroachment
      ? {
          watercourseEncroachment: side?.watercourseEncroachment ?? null,
          riparianEncroachment: riparian(side?.riparianEncroachment)
        }
      : {}
  return {
    baseline: (feature) => ({
      habitatType: feature.type ?? null,
      size: kilometres(feature),
      ...encroachments(feature)
    }),
    proposed: (feature) => ({
      habitatType: feature.proposed?.type ?? null,
      size: kilometres(feature),
      ...encroachments(feature.proposed)
    })
  }
}

const AREA_LAYERS = Object.freeze({
  habitats: areaColumns(),
  verticalHabitats: areaColumns(),
  trees: areaColumns({ tree: true })
})
const HEDGEROWS = {
  ...linearColumns(),
  templateByParts: true,
  legacyLostIsLost: true
}
const WATERCOURSES = {
  ...linearColumns({ encroachment: true }),
  templateEnhancedAsDrawn: true,
  legacyLostIsLost: true
}

function baselineRow(layer, feature) {
  return {
    reference: feature.ref ?? null,
    ...layer.baseline(feature),
    condition: feature.condition ?? null,
    strategicSignificance: BASELINE_SIGNIFICANCE
  }
}

function proposedRow(layer, feature) {
  const proposed = feature.proposed ?? {}
  return {
    reference: feature.ref ?? null,
    ...layer.proposed(feature),
    condition: proposed.condition ?? null,
    strategicSignificance: significance(
      proposed.strategicSignificanceCategory ?? proposed.strategicSignificance
    ),
    advanceYears: years(proposed, 'advanceYears'),
    delayYears: years(proposed, 'delayYears')
  }
}

const sizeOf = (rows) => rows.reduce((sum, row) => sum + (row.size ?? 0), 0)

/** A baseline row kept whole by one Retained or Enhanced feature. */
function keptWhole(layer, row, child, template) {
  if (resolveRetentionCategory(child) === RETENTION_RETAINED) {
    return { ...row, retained: row.size }
  }
  const enhancement = proposedRow(layer, child)
  const asDrawn =
    template && layer.templateEnhancedAsDrawn && enhancement.size > 0
  return {
    ...row,
    enhanced: asDrawn ? enhancement.size : row.size,
    enhancement
  }
}

/**
 * A baseline row kept in parts: retained and enhanced by its parts' sizes,
 * with one enhancement row, the first Enhanced part's, for them all, as the
 * metric pairs one enhancement row with each enhanced baseline row.
 */
function keptInParts(layer, row, children) {
  const byCategory = (category) =>
    children
      .filter((child) => resolveRetentionCategory(child) === category)
      .map((child) => proposedRow(layer, child))
  const retained = byCategory(RETENTION_RETAINED)
  const enhanced = byCategory(RETENTION_ENHANCED)
  const placed = { ...row }
  if (retained.length > 0) {
    placed.retained = sizeOf(retained)
  }
  if (enhanced.length > 0) {
    placed.enhanced = sizeOf(enhanced)
    placed.enhancement = { ...enhanced[0], size: placed.enhanced }
  }
  return placed
}

/**
 * A baseline row, placed by the features it becomes. One that becomes more
 * than one, as a habitat that gets worse in part does (a Retained part and a
 * Created one), is placed by its parts' sizes, as is a template hedgerow.
 */
function placeBaseline(layer, feature, children, template) {
  const row = baselineRow(layer, feature)
  const kept = children.filter((child) =>
    KEPT.has(resolveRetentionCategory(child))
  )
  if (kept.length === 0) {
    return row
  }
  const inParts =
    children.length > 1 || (template && layer.templateByParts === true)
  return inParts
    ? keptInParts(layer, row, kept)
    : keptWhole(layer, row, kept[0], template)
}

/**
 * The post-intervention features each baseline feature becomes: a template
 * upload's every child that names it as its parent, and a legacy upload's
 * Retained or Enhanced row of its ref, as a legacy Created row of the same
 * ref is its replacement, not a part of it.
 */
function childrenByBaseline(postFeatures, template) {
  const linked = template
    ? postFeatures
    : postFeatures.filter((feature) =>
        KEPT.has(resolveRetentionCategory(feature))
      )
  const keyOf = template
    ? (feature) => feature.parentFeatureId
    : (feature) => feature.ref
  const baselineKeyOf = template
    ? (feature) => feature.featureId
    : (feature) => feature.ref
  const byKey = Map.groupBy(
    linked.filter((feature) => keyOf(feature) != null),
    keyOf
  )
  return (feature) => byKey.get(baselineKeyOf(feature)) ?? []
}

/**
 * Whether a baseline row's enhancement goes on the sheet. The metric pairs
 * its enhancement rows by position with the baseline rows enhanced by more
 * than nothing, and bng-library's writer refuses a workbook whose counts
 * differ, so an Enhanced feature with no size yet (an incomplete one) has no
 * enhancement row until it has one.
 */
const pairedEnhancement = (row) => row.enhancement && row.enhanced > 0

/**
 * Whether a post-intervention feature is a creation row. A legacy linear
 * feature marked Lost has no category of its own and reads as Created from
 * its baseline's, but the service's enrichment and trading rules treat it as
 * lost (`isLegacyLostLinear`), so it is not one.
 */
function isCreation(layer, feature) {
  if (layer.legacyLostIsLost && isLegacyLostLinear(feature)) {
    return false
  }
  return resolveRetentionCategory(feature) === RETENTION_CREATED
}

/** One habitat kind's baseline, creation and enhancement rows. */
function layerRows(layers, project, template) {
  const baselineRows = []
  const creationRows = []
  for (const [key, layer] of layers) {
    const baselineFeatures = project.baseline?.[key] ?? []
    const postFeatures = project.postIntervention?.[key] ?? []
    const childrenOf = childrenByBaseline(postFeatures, template)
    for (const feature of baselineFeatures) {
      baselineRows.push(
        placeBaseline(layer, feature, childrenOf(feature), template)
      )
    }
    creationRows.push(
      ...postFeatures
        .filter((feature) => isCreation(layer, feature))
        .map((feature) => proposedRow(layer, feature))
    )
  }
  return {
    baseline: baselineRows.map(({ enhancement: _enhancement, ...row }) => row),
    creation: creationRows,
    enhancement: baselineRows
      .filter(pairedEnhancement)
      .map((row) => row.enhancement)
  }
}

/**
 * @param {{ baseline?: object, postIntervention?: object }} project the
 *   project document, as `GET /projects/{id}` holds it under `project`
 * @returns {Record<string, object[]>} rows keyed as METRIC_SHEETS
 */
export function metricRowsFromProject(project) {
  const template = isTemplateUpload(project.postIntervention)
  const areas = layerRows(Object.entries(AREA_LAYERS), project, template)
  const hedgerows = layerRows([['hedgerows', HEDGEROWS]], project, template)
  const watercourses = layerRows(
    [['watercourses', WATERCOURSES]],
    project,
    template
  )
  return {
    habitatBaseline: areas.baseline,
    habitatCreation: areas.creation,
    habitatEnhancement: areas.enhancement,
    hedgerowBaseline: hedgerows.baseline,
    hedgerowCreation: hedgerows.creation,
    hedgerowEnhancement: hedgerows.enhancement,
    watercourseBaseline: watercourses.baseline,
    watercourseCreation: watercourses.creation,
    watercourseEnhancement: watercourses.enhancement
  }
}
