import { enrichPostInterventionHedgerowWithUnits } from '../../../utilities/enrichment/post-intervention/enrich-post-intervention-hedgerow.js'
import { NO_OP_LOGGER } from '../../../utilities/enrichment/shared/enrich-units-shared.js'
import { HABITAT_STATUS } from '../../../services/upload/habitat-status.js'
import { pickProposedRecomputeFields } from './recompute-post-intervention-area-habitat.js'

/**
 * Recompute a post-intervention hedgerow after a dropdown edit, through the
 * same enrichment as the upload, as area habitats are
 * (recompute-post-intervention-area-habitat.js). The baseline calculator
 * prices a created or enhanced hedgerow without its time, difficulty or
 * strategic significance multipliers, and never rejects an invalid strategic
 * significance (BMD-1051), so a hedgerow nulled on import came back priced.
 *
 * @param {object} existing — persisted post-intervention hedgerow feature
 * @param {{ habitatType: string | null, condition: string | null }} edits
 * @param {object} options
 * @param {Map<string, number>} [options.baselineLengthByRef] baseline lengths
 *   by ref, which an enhanced hedgerow prices its baseline side from
 * @param {{ warn: Function }} [options.logger]
 * @returns {object} the recomputed proposed fields, `units`, `status` and the
 *   whole `updatedFeature`, as recomputePostInterventionAreaHabitat returns
 */
export function recomputePostInterventionHedgerow(
  existing,
  edits,
  { baselineLengthByRef, logger = NO_OP_LOGGER } = {}
) {
  const feature = structuredClone(existing)
  feature.proposed = {
    ...feature.proposed,
    type: edits.habitatType,
    condition: edits.condition
  }
  feature.units = null
  feature.status = HABITAT_STATUS.INCOMPLETE

  enrichPostInterventionHedgerowWithUnits(feature, logger, baselineLengthByRef)

  return {
    ...pickProposedRecomputeFields(feature.proposed),
    units: feature.units ?? null,
    status: feature.status,
    updatedFeature: feature
  }
}
