// Guard shared by the baseline and post-intervention enrichment paths for
// vertical area habitats (green walls / intertidal structures).
//
// Vertical area habitats are AREA habitats in the metric, but they are drawn
// as LINESTRINGs: their unit-bearing size is the hand-entered face `Area` (m²)
// column, stamped onto `feature.area` at extract time — never a PostGIS
// measurement. A row whose Area is missing or unusable must yield no units and
// a logged note, not a crash, so both enrichment paths call this guard before
// running the ordinary area-habitat calculation.

/** Log label for vertical area habitat enrichment notes. */
export const VERTICAL_AREA_LABEL = 'Vertical area habitat'

/**
 * True when the feature carries no usable hand-entered face area, in which
 * case a note is logged and the caller must skip unit calculation.
 *
 * @param {{ featureId?: string, area?: unknown }} feature
 * @param {{ warn: (msg: string) => void }} logger
 * @param {string} logPrefix e.g. LOG_ENRICH_PREFIX / LOG_ENRICH_PI_PREFIX
 * @returns {boolean}
 */
export function verticalAreaFaceAreaMissing(feature, logger, logPrefix) {
  const area = feature?.area
  if (typeof area === 'number' && Number.isFinite(area) && area > 0) {
    return false
  }
  const featureId = feature?.featureId ?? 'unknown'
  logger.warn(
    `${logPrefix}${VERTICAL_AREA_LABEL} featureId ${featureId} has no usable hand-entered face Area (m²) — no units calculated`
  )
  return true
}
