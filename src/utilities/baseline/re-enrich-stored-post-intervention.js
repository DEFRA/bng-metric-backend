import { eq } from 'drizzle-orm'

import { setProjectHabitatData } from '../../db/persist-project.js'
import { projects } from '../../db/schema/index.js'
import { buildBaselineLinearLengthByRef } from './baseline-linear-length-by-ref.js'
import { enrichPostInterventionDocumentWithUnits } from './enrich-post-intervention-units.js'

/**
 * When baseline is saved after post-intervention, re-run unit enrichment on the
 * stored post-intervention document so Enhanced linear features can resolve
 * baseline lengths. No-op when the project has no post-intervention data.
 *
 * @param {import('drizzle-orm/node-postgres').NodePgDatabase} drizzle
 * @param {string} projectId
 * @param {{ warn: (msg: string) => void }} logger
 * @returns {Promise<void>}
 */
export async function reEnrichStoredPostInterventionIfPresent(
  drizzle,
  projectId,
  logger
) {
  const [row] = await drizzle
    .select({ project: projects.project })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  const postIntervention = row?.project?.postIntervention
  if (!postIntervention) {
    return
  }

  const hasFeatures =
    (postIntervention.habitats?.length ?? 0) > 0 ||
    (postIntervention.hedgerows?.length ?? 0) > 0 ||
    (postIntervention.watercourses?.length ?? 0) > 0
  if (!hasFeatures) {
    return
  }

  const baseline = row.project.baseline
  const baselineLengthByRef = buildBaselineLinearLengthByRef(
    baseline?.hedgerows ?? [],
    baseline?.watercourses ?? []
  )

  enrichPostInterventionDocumentWithUnits(postIntervention, logger, {
    baselineLengthByRef,
    baselineUnits: baseline?.units
  })

  await setProjectHabitatData(
    drizzle,
    projectId,
    postIntervention,
    'postIntervention'
  )
}
