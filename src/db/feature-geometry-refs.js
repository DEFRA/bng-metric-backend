/**
 * Keep the ref copied onto each PostGIS geometry row in step with the project
 * document when an edit renames features (BMD-1061).
 *
 * persist-upload.js writes every geometry row with its feature's ref. Nothing
 * reads that column back today — the site report joins geometry to the
 * document by featureId (project-geometry.js) and takes the ref from the
 * document — but a renamed feature should not leave the old ref behind in a
 * table that says what each shape is.
 */

import { and, eq } from 'drizzle-orm'

import { FEATURE_TABLE_SETS } from './feature-tables.js'

/**
 * @param {object} exec Drizzle transaction (or client)
 * @param {string} projectId
 * @param {Array<{ documentKey: string, layer: string, featureId: string, ref: string }>} renames
 *   from listRenamedRefs
 */
export async function setGeometryRefs(exec, projectId, renames) {
  for (const { documentKey, layer, featureId, ref } of renames) {
    const table = FEATURE_TABLE_SETS[documentKey]?.[layer]
    // The red line has a geometry table but no ref column.
    if (!table?.ref) {
      continue
    }
    // One transaction holds one connection, so the updates run in turn.
    await exec // NOSONAR S9382
      .update(table)
      .set({ ref })
      .where(and(eq(table.id, featureId), eq(table.projectId, projectId)))
  }
}
