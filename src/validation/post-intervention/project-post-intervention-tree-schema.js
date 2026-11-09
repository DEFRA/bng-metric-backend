/**
 * Joi schema for a post-intervention individual tree. Trees are points, so
 * each side carries its own notional area on top of the shared
 * distinctiveness and condition fields.
 */
import Joi from 'joi'
import {
  baselineCommonFields,
  postInterventionAreaFeatureFields,
  proposedCommonFields
} from './project-post-intervention-fields.js'

import { BASELINE_STRATEGIC_SIGNIFICANCE_DESCRIPTION } from '../project-shared-schemas.js'
import { listedFileText, shortFileText } from '../text-joi.js'

function treeSideCommonFields() {
  return {
    type: shortFileText().description(
      "Tree habitat type — 'Urban tree' or 'Rural tree', derived from the Rural or Urban Tree column."
    ),
    broadType: listedFileText('broadType').description(
      "Always 'Individual trees' for tree features."
    ),
    ...baselineCommonFields(),
    strategicSignificance: listedFileText('strategicSignificance').description(
      'Strategic Significance from the GeoPackage.'
    ),
    treeSize: listedFileText('treeSize').description(
      "Tree size band from the GeoPackage (e.g. 'Medium'); determines the per-tree area."
    ),
    treeSpecies: listedFileText('treeSpecies').description(
      'Tree species/type free text (Tree Type column).'
    ),
    ruralOrUrban: listedFileText('ruralOrUrban').description(
      'Raw Rural or Urban Tree value as written in the GeoPackage.'
    ),
    sizeSquareMetres: Joi.number()
      .allow(null)
      .description(
        'Notional tree area in square metres: the per-size reference area times the Count column.'
      ),
    area: Joi.number()
      .allow(null)
      .description(
        'Notional tree area in square metres: the per-size reference area times the Count column, rounded.'
      )
  }
}

const postInterventionTreeBaselineSubSchema = Joi.object({
  ...treeSideCommonFields(),
  strategicSignificance: listedFileText('strategicSignificance').description(
    BASELINE_STRATEGIC_SIGNIFICANCE_DESCRIPTION
  )
}).description(
  'Baseline individual-tree values from the Baseline * GeoPackage columns.'
)

const postInterventionTreeProposedSubSchema = Joi.object({
  ...treeSideCommonFields(),
  // Trees enrich via the area-habitat path, so a Created or Enhanced tree
  // carries the same proposed-side fields (condition, advance/delay years and
  // the engine time/difficulty multipliers) as an area parcel. Reuse the shared
  // factory so any future engine field flows to trees automatically — omitting
  // one previously caused persistence to reject non-retained trees.
  ...proposedCommonFields()
}).description(
  'Proposed individual-tree values from the Proposed * GeoPackage columns.'
)

export const postInterventionTreeSchema = Joi.object({
  ...postInterventionAreaFeatureFields({
    geometryRow: 'bng.post_intervention_trees',
    refDescription: 'Tree reference from the GeoPackage (Tree Ref column).',
    areaDescription:
      'Notional tree area in square metres (proposed side), rounded.',
    sizeDescription: 'Notional tree area in square metres (proposed side).',
    unitsDescription:
      'Post-intervention biodiversity units for the tree, calculated from proposed values.'
  }),
  count: Joi.number()
    .allow(null)
    .description(
      'Count column from the GeoPackage: the number of trees the point stands for. Both sides are priced for that many trees; a blank count is priced as one tree, and any other value that is not a whole number of trees is refused at upload (TREE_COUNT_NOT_WHOLE).'
    ),
  baseline: postInterventionTreeBaselineSubSchema,
  proposed: postInterventionTreeProposedSubSchema,
  properties: Joi.object()
    .unknown(true)
    .description(
      'Raw attribute columns copied verbatim from the GeoPackage Urban Trees layer.'
    )
}).description(
  'A post-intervention individual tree (point) with nested baseline and proposed sub-objects.'
)
