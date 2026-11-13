import { PARENT_UUID } from 'bng-library/bng-service'
import { lengthMetres } from 'bng-library/measure'
import { MAX_YEARS_PLUS } from 'bng-library/metric'

import { ERROR_CODES } from '../../errors.js'
import {
  PROPOSED_PROP_KEYS,
  PROP_KEYS,
  TREE_ADVANCE_DELAY_KEYS,
  pickProp
} from '../../properties.js'
import { INDIVIDUAL_TREES_BROAD_HABITAT } from '../../tree-constants.js'
import { SQ_METRES_PER_HECTARE } from '../../tree-sizes.js'
import { verticalAreaSquareMetres } from '../../vertical-area-check.js'
import { parseProposedAdvanceDelayYears } from '../../post-intervention/extract-post-intervention-sub-objects.js'
import {
  LENGTH_TOLERANCE_METRES,
  createdInOwnTypeMetres,
  isLowerCondition,
  isSameHabitatType,
  watercourseChange
} from './habitat-change.js'
import {
  baselineHabitatTypeOf,
  canDegrade,
  collated,
  continues,
  habitatTypeOf,
  isCreated,
  label,
  parentsByUuid,
  refOf,
  text
} from './lineage-rows.js'

/**
 * The Metric's rules on how a BNG Service template file's post-intervention
 * habitats continue, lose or degrade their baseline parents (BMD-1083). Run
 * once the parent links themselves can be trusted (parent-links.js), so each
 * row's `parent_uuid` names exactly one baseline feature of its layer. Each
 * rule the file breaks refuses it, as its units cannot be calculated as the
 * Metric guide asks:
 *
 * - hedgerows: the post-intervention hedgerows linked to a parent, Created
 *   ones included, never total more than its length;
 * - vertical area habitats: likewise, the post-intervention vertical area
 *   habitats linked to a parent never total more than its Area, the area the
 *   surveyor estimated, as a structure cannot gain face it never had;
 * - watercourses: a parent continues only through a Retained or Enhanced
 *   child, so one with both such a child and a Created child cannot have its
 *   length split between continuation and loss. The surveyor draws the
 *   baseline watercourse as two features, one for each part;
 * - watercourses: only a canal or a ditch can be permanently lost, so any
 *   other baseline watercourse with no post-intervention child is refused;
 * - a degraded row, a Created row linked to a parent of its own habitat type,
 *   must be worse than its parent, or the habitat was kept and should be
 *   Retained or Enhanced. An area habitat, vertical area habitat or hedgerow
 *   gets worse by a lower
 *   condition, and is created 30+ years in advance (guide, "Habitat
 *   retention"). A watercourse gets worse by a lower condition, more
 *   encroachment or a shorter length (guide, watercourse interventions);
 *   its length is the parent's same-type Created rows together, so a
 *   watercourse drawn in pieces is not shorter for that alone.
 *   A Created row of its parent's type with a delay is not degraded: it is a
 *   habitat lost for a time and put back (guide, "Accounting for temporary
 *   losses"), which the delay already discounts, so it may be in any
 *   condition and needs no years in advance.
 * - individual trees: each point is one tree, so a parent is kept by one
 *   post-intervention tree at most, as a tree that is kept cannot multiply.
 *   Newly Planted trees are not counted against it. A tree is an area
 *   habitat, so an Existing tree Created in its parent's Urban or Rural
 *   setting is the parent itself, counted with the kept trees, and a degraded
 *   row like any other: it must be in a lower
 *   condition and created 30+ years in advance. A Newly Planted tree linked
 *   to a parent is planting in its place, and no degraded row.
 */

/** A layer's years created in advance and years of delay columns; trees name theirs differently. */
const timingKeys = (layer) =>
  layer === 'trees' ? TREE_ADVANCE_DELAY_KEYS : PROPOSED_PROP_KEYS
const advanceOf = (layer, properties) =>
  pickProp(properties, timingKeys(layer).advanceYears)
const delayOf = (layer, properties) =>
  pickProp(properties, timingKeys(layer).delayYears)

/** The watercourse types the Metric lets be permanently lost. */
const REMOVABLE_RIVER_TYPES = new Set(['canals', 'ditches'])

const LINEAR_LAYERS = new Set(['hedgerows', 'watercourses'])

/** The layers checked, area habitats first, as the messages list them. */
const CHECKED_LAYERS = ['areas', 'verticalHabitats', ...LINEAR_LAYERS, 'trees']

/**
 * A row's broad habitat, as the Metric's condition scores are keyed: a tree's
 * is always Individual trees, which its table has no column for.
 */
const broadTypeOf = (layer, properties, column) =>
  layer === 'trees' ? INDIVIDUAL_TREES_BROAD_HABITAT : text(properties[column])

/**
 * The difference in area, in square metres, below which two typed areas are
 * the same: the template takes an area to the square centimetre at most.
 */
const AREA_TOLERANCE_SQUARE_METRES = 0.0001

/** Metres to the millimetre, as the messages give them. */
const MILLIMETRES = 1000
const toMillimetre = (metres) => Math.round(metres * MILLIMETRES) / MILLIMETRES

/** Square metres to two places, as the messages give them. */
const HUNDREDTHS = 100
const toHundredth = (squareMetres) =>
  Math.round(squareMetres * HUNDREDTHS) / HUNDREDTHS

/**
 * Square metres in hectares, as the surveyor typed them, without the noise the
 * division adds: 50.1 m² is 0.00501 ha.
 */
const SIGNIFICANT_FIGURES = 12
const toHectares = (squareMetres) =>
  Number(
    (squareMetres / SQ_METRES_PER_HECTARE).toPrecision(SIGNIFICANT_FIGURES)
  )

/** A baseline row as the comparisons read it. */
function baselineSide(layer, properties) {
  return {
    type: baselineHabitatTypeOf(layer, properties),
    broadType: broadTypeOf(layer, properties, 'Baseline Broad Habitat Type'),
    condition: text(properties['Baseline Condition']),
    watercourseEncroachment: text(
      properties['Baseline Encroachment into Watercourse']
    ),
    riparianEncroachment: text(
      properties['Baseline Encroachment into riparian zone']
    )
  }
}

/** A post-intervention row as the comparisons read it. */
function proposedSide(layer, properties) {
  return {
    type: habitatTypeOf(layer, properties),
    broadType:
      broadTypeOf(layer, properties, 'Proposed Broad Habitat Type') ??
      broadTypeOf(layer, properties, 'Baseline Broad Habitat Type'),
    condition: text(properties['Proposed Condition']),
    watercourseEncroachment: text(
      properties['Proposed Encroachment into Watercourse']
    ),
    riparianEncroachment: text(
      properties['Proposed Encroachment into riparian zone']
    )
  }
}

const measured = (feature) =>
  feature.nativeGeometry ? lengthMetres(feature.nativeGeometry) : Number.NaN

/** A post-intervention row a rule refuses. */
function offendingRow(layer, table, feature, parent) {
  const { properties } = feature
  return {
    layer,
    table,
    fid: properties.fid,
    ref: refOf(properties),
    habitatType: habitatTypeOf(layer, properties),
    parentRef: refOf(parent.properties)
  }
}

/** A baseline parent a rule refuses, with the refs of its children. */
function offendingParent(layer, table, parent, children) {
  const { properties } = parent
  return {
    layer,
    table,
    fid: properties.fid,
    ref: refOf(properties),
    habitatType: baselineHabitatTypeOf(layer, properties),
    childRefs: children.map((child) => refOf(child.properties))
  }
}

/**
 * Each baseline feature of a layer with the post-intervention rows linked to
 * it. A feature with no `feature_uuid`, or one another feature shares, has no
 * children: the parent checks have refused any row that names one.
 */
function familiesOf(baseline, postIntervention) {
  const parents = parentsByUuid(baseline)
  const families = new Map(baseline.map((parent) => [parent, []]))
  for (const child of postIntervention) {
    const named = parents.get(text(child.properties?.[PARENT_UUID]))
    if (named?.length === 1) {
      families.get(named[0]).push(child)
    }
  }
  return families
}

/** A hedgerow parent shorter than its linked children together. */
function checkHedgerowLength(parent, children, context) {
  if (children.length === 0) {
    return
  }
  const parentMetres = measured(parent)
  const childMetres = children.reduce((sum, child) => sum + measured(child), 0)
  if (childMetres > parentMetres + LENGTH_TOLERANCE_METRES) {
    context.found.tooLong.push({
      ...offendingParent(
        context.layer,
        context.tables.baseline,
        parent,
        children
      ),
      lengthMetres: toMillimetre(parentMetres),
      childLengthMetres: toMillimetre(childMetres)
    })
  }
}

/**
 * A row's typed Area, in hectares, as square metres; 0 when it is not a number above 0.
 * Read as the upload check and the extract read it: from Area only.
 */
const typedArea = (feature) =>
  verticalAreaSquareMetres(
    pickProp(feature.properties, PROP_KEYS.verticalArea)
  ) ?? 0

/** A vertical area habitat parent smaller than its linked children together. */
function checkVerticalArea(parent, children, context) {
  if (children.length === 0) {
    return
  }
  const parentArea = typedArea(parent)
  const childArea = children.reduce((sum, child) => sum + typedArea(child), 0)
  if (childArea > parentArea + AREA_TOLERANCE_SQUARE_METRES) {
    context.found.tooLarge.push({
      ...offendingParent(
        context.layer,
        context.tables.baseline,
        parent,
        children
      ),
      areaSquareMetres: toHundredth(parentArea),
      childAreaSquareMetres: toHundredth(childArea)
    })
  }
}

/**
 * A tree parent kept by more than one post-intervention tree: its Retained
 * and Enhanced trees, and an Existing tree Created in its setting, which is
 * the parent recorded as lost and created again. Each point is one tree, so
 * one of them at most can be it.
 */
function checkTreeKeptOnce(parent, children, context) {
  const kept = children.filter(
    (child) =>
      continues(child.properties) ||
      isCreatedInOwnType(context.layer, parent, child)
  )
  if (kept.length > 1) {
    context.found.tooManyTrees.push(
      offendingParent(context.layer, context.tables.baseline, parent, kept)
    )
  }
}

/** A watercourse parent split between continuation and creation, or lost. */
function checkWatercourseFamily(parent, children, context) {
  const { layer, tables, found } = context
  if (children.length === 0) {
    const type = baselineHabitatTypeOf(layer, parent.properties)
    if (!REMOVABLE_RIVER_TYPES.has(type?.toLowerCase())) {
      found.naturalLost.push(
        offendingParent(layer, tables.baseline, parent, children)
      )
    }
    return
  }
  const kept = children.some((child) => continues(child.properties))
  const created = children.some((child) => isCreated(child.properties))
  if (kept && created) {
    found.partCreated.push(
      offendingParent(layer, tables.baseline, parent, children)
    )
  }
}

/** Whether a row is put back after a temporary loss: it has a delay. */
const isPutBack = (layer, properties) =>
  (parseProposedAdvanceDelayYears(delayOf(layer, properties)) ?? 0) > 0

/** Whether a row is Created in its parent's habitat type. */
const isCreatedInOwnType = (layer, parent, child) =>
  isCreated(child.properties) &&
  canDegrade(layer, child.properties) &&
  isSameHabitatType(
    baselineSide(layer, parent.properties),
    proposedSide(layer, child.properties)
  )

/** A parent's Created children, as createdInOwnTypeMetres reads them. */
const createdChildren = (layer, children) =>
  children
    .filter((child) => isCreated(child.properties))
    .map((child) => ({
      side: proposedSide(layer, child.properties),
      lengthMetres: measured(child)
    }))

/**
 * A parent's same-type Created length, worked out the first time one of its
 * pieces asks and then shared: a parent may have thousands of children.
 */
function createdMetresOnce(layer, parent, children) {
  let metres
  return () => {
    metres ??= createdInOwnTypeMetres(
      baselineSide(layer, parent.properties),
      createdChildren(layer, children)
    )
    return metres
  }
}

/** A degraded row that is not worse, or not created 30+ years in advance. */
function checkDegradedRow(parent, child, createdMetres, context) {
  const { layer, tables, found } = context
  const parentSide = baselineSide(layer, parent.properties)
  const childSide = proposedSide(layer, child.properties)
  if (
    !isCreatedInOwnType(layer, parent, child) ||
    isPutBack(layer, child.properties)
  ) {
    return
  }
  const row = () => offendingRow(layer, tables.postIntervention, child, parent)
  if (layer === 'watercourses') {
    const change = watercourseChange(
      { side: parentSide, lengthMetres: measured(parent) },
      {
        side: childSide,
        lengthMetres: createdMetres()
      }
    )
    if (!change.worse) {
      found.noIntervention.push(row())
    }
    return
  }
  if (!isLowerCondition(layer, parentSide, childSide)) {
    // Not degraded at all, so the 30+ years a degraded row needs is beside
    // the point: one error, saying what it should be instead.
    found.notWorse.push(row())
    return
  }
  if (text(advanceOf(layer, child.properties)) !== MAX_YEARS_PLUS) {
    found.advanceNot30Plus.push(row())
  }
}

function checkLayer(layer, baseline, postIntervention, found) {
  const context = {
    layer,
    tables: {
      baseline: baseline.table,
      postIntervention: postIntervention.table
    },
    found
  }
  const families = familiesOf(baseline.features, postIntervention.features)
  for (const [parent, children] of families) {
    if (layer === 'hedgerows') {
      checkHedgerowLength(parent, children, context)
    }
    if (layer === 'verticalHabitats') {
      checkVerticalArea(parent, children, context)
    }
    if (layer === 'watercourses') {
      checkWatercourseFamily(parent, children, context)
    }
    if (layer === 'trees') {
      checkTreeKeptOnce(parent, children, context)
    }
    const createdMetres = createdMetresOnce(layer, parent, children)
    for (const child of children) {
      checkDegradedRow(parent, child, createdMetres, context)
    }
  }
}

const describeRow = (row) => `${label(row)}, copied from ${row.parentRef}`
const describeParent = (parent) =>
  parent.childRefs.length > 0
    ? `${label(parent)}, copied to ${parent.childRefs.join(', ')}`
    : label(parent)

/**
 * Each rule's error: its code, the heading the message opens with, the
 * offenders it lists (a key of checkLineageRules' `found`) and how each is
 * named.
 */
const RULE_ERRORS = [
  {
    code: ERROR_CODES.STAGED_HEDGEROW_CHILDREN_TOO_LONG,
    heading:
      'One or more baseline hedgerows are shorter than the post-intervention hedgerows linked to them together',
    found: 'tooLong',
    describe: (parent) =>
      `${describeParent(parent)} (${parent.lengthMetres} m, linked ${parent.childLengthMetres} m)`
  },
  {
    code: ERROR_CODES.STAGED_VERTICAL_CHILDREN_TOO_LARGE,
    heading:
      'One or more baseline vertical area habitats have a smaller Area (ha) than the post-intervention vertical area habitats linked to them together',
    found: 'tooLarge',
    describe: (parent) =>
      `${describeParent(parent)} (${toHectares(parent.areaSquareMetres)} ha, linked ${toHectares(parent.childAreaSquareMetres)} ha)`
  },
  {
    code: ERROR_CODES.STAGED_TREE_CHILDREN_TOO_MANY,
    heading:
      'One or more baseline trees have more than one kept tree linked to them. A post-intervention tree is kept if it is Retained or Enhanced, or Created with Category Existing in the same Urban or Rural setting. A baseline tree is one tree, so only one kept tree can be linked to it',
    found: 'tooManyTrees',
    describe: describeParent
  },
  {
    code: ERROR_CODES.STAGED_WATERCOURSE_RETAINED_AND_CREATED,
    heading:
      'One or more baseline watercourses have both a Retained or Enhanced part and a Created part, so their length cannot be split between what continues and what is lost. Draw each as two baseline watercourses, one for each part',
    found: 'partCreated',
    describe: describeParent
  },
  {
    code: ERROR_CODES.STAGED_NATURAL_WATERCOURSE_LOST,
    heading:
      'One or more baseline watercourses have no post-intervention habitat, but only a canal or a ditch can be permanently lost. Record each as Retained, Enhanced or Created',
    found: 'naturalLost',
    describe: describeParent
  },
  {
    code: ERROR_CODES.STAGED_DEGRADE_NOT_WORSE,
    heading:
      'One or more habitats are Created in their baseline habitat type without a lower condition. A habitat that is kept should be Retained or Enhanced; one lost for a time and put back should give its delay in starting habitat creation',
    found: 'notWorse',
    describe: describeRow
  },
  {
    code: ERROR_CODES.STAGED_DEGRADE_ADVANCE_NOT_30_PLUS,
    heading:
      'One or more habitats recorded as lost and created again in a lower condition are not created 30+ years in advance, as the Metric guide asks',
    found: 'advanceNot30Plus',
    describe: describeRow
  },
  {
    code: ERROR_CODES.STAGED_WATERCOURSE_NO_INTERVENTION,
    heading:
      'One or more watercourses are Created in their baseline River Type with no lower condition, more encroachment or shorter length. A watercourse with no intervention should be Retained; one lost for a time and put back should give its delay in starting habitat creation',
    found: 'noIntervention',
    describe: describeRow
  }
]

/**
 * Check the Metric's lineage rules over every linked post-intervention row.
 *
 * @param {object} baselineLayers readGeoPackage's Baseline tables, read with
 *   their geometry (FEATURE_READ_MODE.full)
 * @param {object} postInterventionLayers readGeoPackage's Post-Intervention
 *   tables, read with their geometry
 * @returns {Array<{ code: string, message: string, details: object }>} one
 *   error per rule broken, listing every row or parent it applies to
 */
export function checkLineageRules(baselineLayers, postInterventionLayers) {
  const found = {
    tooLong: [],
    tooLarge: [],
    tooManyTrees: [],
    partCreated: [],
    naturalLost: [],
    notWorse: [],
    advanceNot30Plus: [],
    noIntervention: []
  }
  for (const layer of CHECKED_LAYERS) {
    checkLayer(
      layer,
      {
        table: baselineLayers.layerTables?.[layer],
        features: baselineLayers[layer] ?? []
      },
      {
        table: postInterventionLayers.layerTables?.[layer],
        features: postInterventionLayers[layer] ?? []
      },
      found
    )
  }
  return RULE_ERRORS.map(({ code, heading, found: key, describe }) =>
    collated(code, heading, found[key], describe)
  ).filter(Boolean)
}
