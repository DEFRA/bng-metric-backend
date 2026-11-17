// The inputs `enrichPostInterventionDocumentWithUnits` takes from the baseline,
// assembled in one place.
//
// Two paths enrich a post-intervention document: the upload
// (save-upload-for-project.js) and the baseline-edit re-derive
// (resync-post-intervention-baseline.js). Building the options separately in
// each would let them drift in what they feed the enrichment — which is the
// exact class of bug the re-derive exists to fix.

import { buildBaselineLinearLengthByRef } from './linear-baseline-length-by-ref.js'

/**
 * @param {object | undefined} baseline the project's stored baseline document
 * @returns {{ baselineLengthByRef: Map<string, number>, baselineUnits: object | undefined, baselineDocument: object | undefined }}
 */
export function postInterventionEnrichOptions(baseline) {
  return {
    baselineLengthByRef: buildBaselineLinearLengthByRef(
      baseline?.hedgerows ?? [],
      baseline?.watercourses ?? []
    ),
    baselineUnits: baseline?.units,
    // Area trading rules need the stored baseline features, not just the
    // totals: a Lost area parcel is persisted as Created, so its baseline units
    // are not recoverable from the post-intervention document.
    baselineDocument: baseline
  }
}
