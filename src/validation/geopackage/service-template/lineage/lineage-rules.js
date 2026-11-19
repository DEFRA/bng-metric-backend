import { PARENT_UUID } from 'bng-library/bng-service'
import { lengthMetres } from 'bng-library/measure'
import { MAX_YEARS_PLUS } from 'bng-library/metric'

import { ERROR_CODES } from '../../errors.js'
import {
  PROP_KEYS,
  TREE_ADVANCE_DELAY_KEYS,
  pickProp
} from '../../properties.js'
import { INDIVIDUAL_TREES_BROAD_HABITAT } from '../../tree-constants.js'
import { SQ_METRES_PER_HECTARE } from '../../tree-sizes.js'
import { verticalAreaSquareMetres } from '../../vertical-area-check.js'
import { parseProposedAdvanceDelayYears } from '../../post-intervention/extract-post-intervention-sub-objects.js'
import { LENGTH_TOLERANCE_METRES, isLowerCondition } from './habitat-change.js'
import {
  baselineHabitatTypeOf,
  collated,
  continues,
  habitatTypeOf,
  isCreated,
  isExistingTree,
  label,
  parentsByUuid,
  refOf,
  text
} from './lineage-rows.js'

/**
 * The Metric's rules on how a BNG Service template file's post-intervention
 * habitats continue or lose their baseline parents (BMD-1083). Run
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
 * - a Created row is a creation, linked to a parent or not, whatever its type
 *   and condition: a habitat that gets worse is recorded as its parent lost
 *   and a creation (guide, "Habitat retention"), and the file is not
 *   refused for how that creation compares with its parent;
 * - individual trees: each point is one tree, so a parent is kept by one
 *   Retained or Enhanced tree at most, as a tree that is kept cannot
 *   multiply. Created trees are not counted against it;
 * - individual trees: an Existing tree Created and linked to its baseline
 *   tree is that tree, lost and created again because its condition gets
 *   worse. Unless it is put back after a delay, it follows the guide's steps
 *   ("Habitat retention"): a lower condition than its baseline tree's, and
 *   created 30+ years in advance. A tree planted in its place is Newly
 *   Planted, and held to neither. Trees alone are checked, as only a tree's
 *   Category says whether a Created row is the habitat itself.
 */

/** The watercourse types the Metric lets be permanently lost. */
const REMOVABLE_RIVER_TYPES = new Set(['canals', 'ditches'])

const LINEAR_LAYERS = new Set(['hedgerows', 'watercourses'])

/** The layers checked, area habitats first, as the messages list them. */
const CHECKED_LAYERS = ['areas', 'verticalHabitats', ...LINEAR_LAYERS, 'trees']

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

const measured = (feature) =>
  feature.nativeGeometry ? lengthMetres(feature.nativeGeometry) : Number.NaN

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
 * A tree parent kept by more than one Retained or Enhanced tree. Each point
 * is one tree, so one of them at most can be it.
 */
function checkTreeKeptOnce(parent, children, context) {
  const kept = children.filter((child) => continues(child.properties))
  if (kept.length > 1) {
    context.found.tooManyTrees.push(
      offendingParent(context.layer, context.tables.baseline, parent, kept)
    )
  }
}

/** A post-intervention row a rule refuses, with its parent's ref. */
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

/** A tree's condition as the Metric's scores read it, at either stage. */
const treeSide = (type, condition) => ({
  type,
  broadType: INDIVIDUAL_TREES_BROAD_HABITAT,
  condition: text(condition)
})

/** Whether a tree is put back after a temporary loss: it has a delay. */
const isPutBack = (properties) =>
  (parseProposedAdvanceDelayYears(
    pickProp(properties, TREE_ADVANCE_DELAY_KEYS.delayYears)
  ) ?? 0) > 0

/**
 * Whether an Existing tree Created over its baseline tree follows the guide:
 * in a lower condition, and created 30+ years in advance. A tree with no
 * Proposed Condition is left Incomplete, as any Created tree is, and not
 * refused for it.
 */
function followsGuide(parent, child) {
  const { properties } = child
  const condition = text(properties['Proposed Condition'])
  if (condition === null) {
    return true
  }
  const lower = isLowerCondition(
    'trees',
    treeSide(
      baselineHabitatTypeOf('trees', parent.properties),
      parent.properties['Baseline Condition']
    ),
    treeSide(habitatTypeOf('trees', properties), condition)
  )
  const advance = text(
    pickProp(properties, TREE_ADVANCE_DELAY_KEYS.advanceYears)
  )
  return lower && advance === MAX_YEARS_PLUS
}

/**
 * Each Existing tree Created over its baseline tree, with no delay, that is
 * not in a lower condition or not created 30+ years in advance.
 */
function checkWorsenedTrees(parent, children, context) {
  for (const child of children) {
    if (
      isCreated(child.properties) &&
      isExistingTree(child.properties) &&
      !isPutBack(child.properties) &&
      !followsGuide(parent, child)
    ) {
      context.found.treeNotDegraded.push(
        offendingRow(
          context.layer,
          context.tables.postIntervention,
          child,
          parent
        )
      )
    }
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
      checkWorsenedTrees(parent, children, context)
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
      'One or more baseline trees have more than one Retained or Enhanced tree linked to them. A baseline tree is one tree, so only one Retained or Enhanced tree can be linked to it',
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
    code: ERROR_CODES.STAGED_TREE_DEGRADE_NOT_VALID,
    heading:
      'One or more Existing trees are Created over their baseline tree, but not in a lower condition or not created 30+ years in advance, as the Metric guide asks for a tree whose condition gets worse. Lower its condition and set its years created in advance to 30+, or, if it is a new tree planted in its place, set its Category to Newly Planted',
    found: 'treeNotDegraded',
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
    treeNotDegraded: []
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
