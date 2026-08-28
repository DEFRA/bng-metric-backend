import Boom from '@hapi/boom'
import { and, eq, sql } from 'drizzle-orm'

import { PG_LOCK_NOT_AVAILABLE } from '../../db/postgres-error-codes.js'
import { visibleToUser } from '../../db/project-visibility.js'
import {
  projects,
  baselineRedLine,
  baselineHabitats,
  baselineHedgerows,
  baselineWatercourses,
  baselineTrees,
  postInterventionRedLine,
  postInterventionHabitats,
  postInterventionHedgerows,
  postInterventionWatercourses,
  postInterventionTrees
} from '../../db/schema/index.js'
import {
  setProjectBaseline,
  setProjectHabitatData
} from '../../db/persist-project.js'
import { EPSG_BNG } from '../../validation/geopackage/geopackage-constants.js'
import { toGeometryJson } from '../../validation/geopackage/geometry-json.js'

/** Cap rows per INSERT to keep statement size bounded for PostGIS bulk loads. */
const INSERT_BATCH_SIZE = 500

/** Maximum wait for the project row lock during concurrent baseline uploads. */
const PERSIST_LOCK_TIMEOUT = '5s'

const BASELINE_FEATURE_TABLES = Object.freeze({
  redLine: baselineRedLine,
  habitats: baselineHabitats,
  hedgerows: baselineHedgerows,
  watercourses: baselineWatercourses,
  trees: baselineTrees
})

const POST_INTERVENTION_FEATURE_TABLES = Object.freeze({
  redLine: postInterventionRedLine,
  habitats: postInterventionHabitats,
  hedgerows: postInterventionHedgerows,
  watercourses: postInterventionWatercourses,
  trees: postInterventionTrees
})

const FEATURE_TABLE_SETS = Object.freeze({
  baseline: BASELINE_FEATURE_TABLES,
  postIntervention: POST_INTERVENTION_FEATURE_TABLES
})

function transformToBngMultiGeomSql(geomJson, sourceSrid) {
  return sql`ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), ${sourceSrid}), ${sql.raw(String(EPSG_BNG))}))`
}

function geometryRowValues(projectId, row) {
  const geomJson = toGeometryJson(row.geometryJson, row.geometry)
  return sql`(
    ${row.featureId}::uuid,
    ${projectId}::uuid,
    ${row.ref ?? null},
    ${transformToBngMultiGeomSql(geomJson, row.srid)}
  )`
}

async function insertGeometryRowsBatched(tx, table, projectId, rows) {
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE)
    const values = batch.map((row) => geometryRowValues(projectId, row))
    await tx.execute(sql`
      INSERT INTO ${table} (id, project_id, ref, geom)
      VALUES ${sql.join(values, sql`, `)}
    `)
  }
}

async function insertRedLineRow(tx, table, projectId, row) {
  const geomJson = toGeometryJson(row.geometryJson, row.geometry)
  await tx.execute(sql`
    INSERT INTO ${table} (id, project_id, geom)
    VALUES (
      ${row.featureId}::uuid,
      ${projectId}::uuid,
      ${transformToBngMultiGeomSql(geomJson, row.srid)}
    )
  `)
}

async function deleteExistingFeatureRows(tx, projectId, featureTables) {
  for (const table of Object.values(featureTables)) {
    await tx.delete(table).where(eq(table.projectId, projectId))
  }
}

// Lock the project row for update — but only if it is visible to the requesting
// user. `visibleToUser(credentials)` scopes to ownership AND the user's CURRENT
// org context AND an approved (status 3) role for it. A project the user doesn't
// own — or that belongs to a different org context than the one they are signed
// into — is indistinguishable from a missing one: it returns 404 without
// writing, matching the sibling write paths (features.js, habitats.js,
// projects.js PATCH).
async function assertProjectExistsForUpdate(tx, projectId, credentials) {
  const projectRows = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), visibleToUser(credentials)))
    .for('update')
    .limit(1)
  if (projectRows.length === 0) {
    throw Boom.notFound(`Project ${projectId} not found`)
  }
}

async function persistGeometryLayers(tx, projectId, geometries, featureTables) {
  if (geometries.redLine) {
    await insertRedLineRow(
      tx,
      featureTables.redLine,
      projectId,
      geometries.redLine
    )
  }
  await insertGeometryRowsBatched(
    tx,
    featureTables.habitats,
    projectId,
    geometries.habitats
  )
  await insertGeometryRowsBatched(
    tx,
    featureTables.hedgerows,
    projectId,
    geometries.hedgerows
  )
  await insertGeometryRowsBatched(
    tx,
    featureTables.watercourses,
    projectId,
    geometries.watercourses
  )
  await insertGeometryRowsBatched(
    tx,
    featureTables.trees,
    projectId,
    geometries.trees ?? []
  )
}

async function updateProjectDocumentSection(
  tx,
  projectId,
  document,
  actorId,
  projectDocumentKey
) {
  if (projectDocumentKey === 'baseline') {
    await setProjectBaseline(tx, projectId, document, actorId)
  } else {
    await setProjectHabitatData(
      tx,
      projectId,
      document,
      actorId,
      projectDocumentKey
    )
  }
}

async function deleteReplacedFeatureRows(
  tx,
  projectId,
  projectDocumentKey,
  featureTables
) {
  await deleteExistingFeatureRows(tx, projectId, featureTables)
  if (projectDocumentKey === 'baseline') {
    await deleteExistingFeatureRows(
      tx,
      projectId,
      FEATURE_TABLE_SETS.postIntervention
    )
  }
}

async function runPersistTransaction(
  drizzle,
  projectId,
  document,
  geometries,
  { projectDocumentKey, featureTables, credentials }
) {
  await drizzle.transaction(async (tx) => {
    await tx.execute(
      sql.raw(`SET LOCAL lock_timeout = '${PERSIST_LOCK_TIMEOUT}'`)
    )

    await assertProjectExistsForUpdate(tx, projectId, credentials)
    await deleteReplacedFeatureRows(
      tx,
      projectId,
      projectDocumentKey,
      featureTables
    )
    await persistGeometryLayers(tx, projectId, geometries, featureTables)
    await updateProjectDocumentSection(
      tx,
      projectId,
      document,
      credentials.sub,
      projectDocumentKey
    )
  })
}

function rethrowPersistError(err, uploadLabel) {
  if (err?.isBoom) {
    throw err
  } else if (err?.code === PG_LOCK_NOT_AVAILABLE) {
    throw Boom.conflict(
      `Another ${uploadLabel} upload for this project is in progress`
    )
  } else {
    throw err
  }
}

/**
 * Replace the persisted baseline document and geometry rows for a project.
 *
 * @param {import('drizzle-orm/node-postgres').NodePgDatabase} drizzle
 * @param {string} projectId
 * @param {object} document
 * @param {object} geometries
 * @param {object} context
 * @param {string} context.uploadId
 * @param {{ info: (msg: string) => void }} context.logger
 * @param {object} context.credentials verified token payload; the write is scoped
 *   to a project visible to this user in their current org context (ownership +
 *   matching relationship + approved role for it)
 */
async function persistUpload(
  drizzle,
  projectId,
  document,
  geometries,
  {
    uploadId,
    logger,
    credentials,
    projectDocumentKey = 'baseline',
    uploadLabel = 'baseline',
    featureTables = FEATURE_TABLE_SETS[projectDocumentKey]
  }
) {
  try {
    await runPersistTransaction(drizzle, projectId, document, geometries, {
      projectDocumentKey,
      featureTables,
      credentials
    })
  } catch (err) {
    rethrowPersistError(err, uploadLabel)
  }

  logger.info(
    `${uploadLabel}: persisted ${uploadLabel} for projectId ${projectId} from uploadId ${uploadId}`
  )
}

/** Label used in logs and the concurrent-upload 409 for staged uploads. */
const STAGED_UPLOAD_LABEL = 'staged'

/**
 * Persist BOTH document subtrees and BOTH geometry-table sets from a single
 * staged GeoPackage in ONE transaction: if either stage fails, neither is
 * written. Holds the same project row lock (and therefore the same
 * concurrent-upload 409 semantics) as the single-stage path.
 *
 * Ordering inside the transaction matters: setProjectBaseline strips the
 * stored postIntervention subtree (a baseline replacement invalidates any
 * previously stored post-intervention), so the post-intervention subtree must
 * be written after it.
 *
 * Vertical area habitats live only in the JSONB documents — no PostGIS table
 * exists for them yet — so persistGeometryLayers ignores their geometry rows.
 *
 * @param {import('drizzle-orm/node-postgres').NodePgDatabase} drizzle
 * @param {string} projectId
 * @param {{ baseline: { document: object, geometries: object }, postIntervention: { document: object, geometries: object } }} stages
 * @param {{ uploadId: string, logger: { info: (msg: string) => void }, credentials: { sub: string } }} context
 */
async function persistStagedUpload(
  drizzle,
  projectId,
  stages,
  { uploadId, logger, credentials }
) {
  try {
    await drizzle.transaction(async (tx) => {
      await tx.execute(
        sql.raw(`SET LOCAL lock_timeout = '${PERSIST_LOCK_TIMEOUT}'`)
      )
      await assertProjectExistsForUpdate(tx, projectId, credentials)
      // The 'baseline' delete wipes the post-intervention feature rows too.
      await deleteReplacedFeatureRows(
        tx,
        projectId,
        'baseline',
        FEATURE_TABLE_SETS.baseline
      )
      await persistGeometryLayers(
        tx,
        projectId,
        stages.baseline.geometries,
        FEATURE_TABLE_SETS.baseline
      )
      await persistGeometryLayers(
        tx,
        projectId,
        stages.postIntervention.geometries,
        FEATURE_TABLE_SETS.postIntervention
      )
      await setProjectBaseline(
        tx,
        projectId,
        stages.baseline.document,
        credentials.sub
      )
      await setProjectHabitatData(
        tx,
        projectId,
        stages.postIntervention.document,
        credentials.sub,
        'postIntervention'
      )
    })
  } catch (err) {
    rethrowPersistError(err, STAGED_UPLOAD_LABEL)
  }

  logger.info(
    `${STAGED_UPLOAD_LABEL}: persisted baseline + post-intervention for projectId ${projectId} from uploadId ${uploadId}`
  )
}

export { persistUpload, persistStagedUpload, FEATURE_TABLE_SETS }
