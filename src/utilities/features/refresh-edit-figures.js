import {
  isTemplateUpload,
  lostBaselineHabitats
} from '../enrichment/post-intervention/lineage-outcomes.js'
import { enrichPostInterventionAreaTradingRules } from '../enrichment/post-intervention/enrich-post-intervention-area-trading-rules.js'
import { enrichPostInterventionWatercourseTradingRules } from '../enrichment/post-intervention/enrich-post-intervention-watercourse-trading-rules.js'
import { enrichPostInterventionHedgerowTradingRules } from '../enrichment/post-intervention/enrich-post-intervention-hedgerow-trading-rules.js'
import { rederivePostInterventionFromBaseline } from '../enrichment/post-intervention/resync-post-intervention-baseline.js'
import {
  addPostInterventionNetUnitChanges,
  summarizeFeatureSetUnitsTotals
} from './feature-set-units.js'

function refreshPostInterventionFigures(featureSet, baseline, logger) {
  if (isTemplateUpload(featureSet)) {
    featureSet.lostHabitats = lostBaselineHabitats(featureSet, baseline)
  }
  addPostInterventionNetUnitChanges(featureSet, baseline?.units)
  enrichPostInterventionAreaTradingRules(featureSet, baseline, logger)
  enrichPostInterventionWatercourseTradingRules(
    featureSet,
    baseline?.watercourses ?? [],
    logger
  )
  enrichPostInterventionHedgerowTradingRules(featureSet, baseline, logger)
}

/**
 * Refresh only the edited document's figures for post-intervention edits.
 * Template watercourse edits are the exception: lineage can change siblings,
 * so their complete post-intervention document is rederived and returned.
 * A baseline edit always rederives the document that measured against it.
 */
export function refreshFiguresDownstreamOfEdit(
  updatedFeatureSet,
  { project, documentKey, previousFeatureSet, editedType, logger }
) {
  if (
    documentKey === 'postIntervention' &&
    editedType === 'watercourse' &&
    isTemplateUpload(updatedFeatureSet)
  ) {
    const rederived = rederivePostInterventionFromBaseline(
      updatedFeatureSet,
      { baseline: project.baseline },
      logger
    )
    Object.assign(updatedFeatureSet, rederived)
    return updatedFeatureSet
  }
  summarizeFeatureSetUnitsTotals(updatedFeatureSet)
  if (documentKey === 'postIntervention') {
    refreshPostInterventionFigures(updatedFeatureSet, project.baseline, logger)
    return null
  }
  return rederivePostInterventionFromBaseline(
    project.postIntervention,
    { baseline: updatedFeatureSet, previousBaseline: previousFeatureSet },
    logger
  )
}
