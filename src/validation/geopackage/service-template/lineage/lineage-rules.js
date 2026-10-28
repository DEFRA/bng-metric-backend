import { PARENT_UUID } from 'bng-library/bng-service'
import { lengthMetres } from 'bng-library/measure'
import { MAX_YEARS_PLUS } from 'bng-library/metric'

import { ERROR_CODES } from '../../errors.js'
import { parseProposedAdvanceDelayYears } from '../../post-intervention/extract-post-intervention-sub-objects.js'
import {
  LENGTH_TOLERANCE_METRES,
  createdInOwnTypeMetres,
  isLowerCondition,
  isSameHabitatType,
  watercourseChange
} from './habitat-change.js'
import {
  REF,
  baselineHabitatTypeOf,
  collated,
  continues,
  habitatTypeOf,
  isCreated,
  label,
  parentsByUuid,
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
 * - watercourses: a parent continues only through a Retained or Enhanced
 *   child, so one with both such a child and a Created child cannot have its
 *   length split between continuation and loss. The surveyor draws the
 *   baseline watercourse as two features, one for each part;
 * - watercourses: only a canal or a ditch can be permanently lost, so any
 *   other baseline watercourse with no post-intervention child is refused;
 * - a degraded row, a Created row linked to a parent of its own habitat type,
 *   must be worse than its parent, or the habitat was kept and should be
 *   Retained or Enhanced. An area habitat or hedgerow gets worse by a lower
 *   condition, and is created 30+ years in advance (guide, "Habitat
 *   retention"). A watercourse gets worse by a lower condition, more
 *   encroachment or a shorter length (guide, watercourse interventions);
 *   its length is the parent's same-type Created rows together, so a
 *   watercourse drawn in pieces is not shorter for that alone.
 *   A Created row of its parent's type with a delay is not degraded: it is a
 *   habitat lost for a time and put back (guide, "Accounting for temporary
 *   losses"), which the delay already discounts, so it may be in any
 *   condition and needs no years in advance.
 *
 * Vertical area habitats (BMD-1084) and individual trees (BMD-1172) are not
 * read yet, so they are not checked.
 */

const ADVANCE = 'Habitat created in advance/years'
const DELAY = 'Delay in starting habitat creation/years'

/** The watercourse types the Metric lets be permanently lost. */
const REMOVABLE_RIVER_TYPES = new Set(['canals', 'ditches'])

const LINEAR_LAYERS = new Set(['hedgerows', 'watercourses'])

/** Metres to the millimetre, as the messages give them. */
const MILLIMETRES = 1000
const toMillimetre = (metres) => Math.round(metres * MILLIMETRES) / MILLIMETRES

/** A baseline row as the comparisons read it. */
function baselineSide(layer, properties) {
  return {
    type: baselineHabitatTypeOf(layer, properties),
    broadType: text(properties['Baseline Broad Habitat Type']),
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
      text(properties['Proposed Broad Habitat Type']) ??
      text(properties['Baseline Broad Habitat Type']),
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
    ref: text(properties[REF]),
    habitatType: habitatTypeOf(layer, properties),
    parentRef: text(parent.properties[REF])
  }
}

/** A baseline parent a rule refuses, with the refs of its children. */
function offendingParent(layer, table, parent, children) {
  const { properties } = parent
  return {
    layer,
    table,
    fid: properties.fid,
    ref: text(properties[REF]),
    habitatType: baselineHabitatTypeOf(layer, properties),
    childRefs: children.map((child) => text(child.properties[REF]))
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
const isPutBack = (properties) =>
  (parseProposedAdvanceDelayYears(properties[DELAY]) ?? 0) > 0

/** Whether a row is Created in its parent's habitat type. */
const isCreatedInOwnType = (layer, parent, child) =>
  isCreated(child.properties) &&
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
    isPutBack(child.properties)
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
  if (text(child.properties[ADVANCE]) !== MAX_YEARS_PLUS) {
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
    if (layer === 'watercourses') {
      checkWatercourseFamily(parent, children, context)
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
    partCreated: [],
    naturalLost: [],
    notWorse: [],
    advanceNot30Plus: [],
    noIntervention: []
  }
  for (const layer of ['areas', ...LINEAR_LAYERS]) {
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
  return [
    collated(
      ERROR_CODES.STAGED_HEDGEROW_CHILDREN_TOO_LONG,
      'One or more baseline hedgerows are shorter than the post-intervention hedgerows linked to them together',
      found.tooLong,
      (parent) =>
        `${describeParent(parent)} (${parent.lengthMetres} m, linked ${parent.childLengthMetres} m)`
    ),
    collated(
      ERROR_CODES.STAGED_WATERCOURSE_RETAINED_AND_CREATED,
      'One or more baseline watercourses have both a Retained or Enhanced part and a Created part, so their length cannot be split between what continues and what is lost. Draw each as two baseline watercourses, one for each part',
      found.partCreated,
      describeParent
    ),
    collated(
      ERROR_CODES.STAGED_NATURAL_WATERCOURSE_LOST,
      'One or more baseline watercourses have no post-intervention habitat, but only a canal or a ditch can be permanently lost. Record each as Retained, Enhanced or Created',
      found.naturalLost,
      describeParent
    ),
    collated(
      ERROR_CODES.STAGED_DEGRADE_NOT_WORSE,
      'One or more habitats are Created in their baseline habitat type without a lower condition. A habitat that is kept should be Retained or Enhanced; one lost for a time and put back should give its delay in starting habitat creation',
      found.notWorse,
      describeRow
    ),
    collated(
      ERROR_CODES.STAGED_DEGRADE_ADVANCE_NOT_30_PLUS,
      'One or more habitats recorded as lost and created again in a lower condition are not created 30+ years in advance, as the Metric guide asks',
      found.advanceNot30Plus,
      describeRow
    ),
    collated(
      ERROR_CODES.STAGED_WATERCOURSE_NO_INTERVENTION,
      'One or more watercourses are Created in their baseline River Type with no lower condition, more encroachment or shorter length. A watercourse with no intervention should be Retained; one lost for a time and put back should give its delay in starting habitat creation',
      found.noIntervention,
      describeRow
    )
  ].filter(Boolean)
}
