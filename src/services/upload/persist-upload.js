import Boom from '@hapi/boom'
import { and, eq, sql } from 'drizzle-orm'

import { PG_LOCK_NOT_AVAILABLE } from '../../db/postgres-error-codes.js'
import { visibleToUser } from '../../db/project-visibility.js'
import { projects } from '../../db/schema/index.js'
import {
  BASELINE_FEATURE_TABLES,
  FEATURE_TABLE_SETS,
  POST_INTERVENTION_FEATURE_TABLES
} from '../../db/feature-tables.js'
import {
  setProjectBaseline,
  setProjectBaselineAndPostIntervention,
  setProjectHabitatData
} from '../../db/persist-project.js'
import { EPSG_BNG } from '../../validation/geopackage/geopackage-constants.js'
import { toGeometryJson } from '../../validation/geopackage/geometry-json.js'

/** Cap rows per INSERT to keep statement size bounded for PostGIS bulk loads. */
const INSERT_BATCH_SIZE = 500

/** Maximum wait for the project row lock during concurrent baseline uploads. */
const PERSIST_LOCK_TIMEOUT = '5s'

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

async function insertGeometryBatch(tx, table, values) {
  await tx.execute(sql`
    INSERT INTO ${table} (id, project_id, ref, geom)
    VALUES ${sql.join(values, sql`, `)}
  `)
}

async function insertGeometryRowsBatched(tx, table, projectId, rows) {
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE)
    const values = batch.map((row) => geometryRowValues(projectId, row))
    // The transaction uses one connection, so the next batch waits until this
    // INSERT finishes and stays within INSERT_BATCH_SIZE.
    await insertGeometryBatch(tx, table, values) // NOSONAR S9382
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

function deleteFeatureRows(tx, table, projectId) {
  return tx.delete(table).where(eq(table.projectId, projectId))
}

// The transaction holds one connection, so each table is cleared before the next starts.
async function deleteExistingFeatureRows(tx, projectId, featureTables) {
  await deleteFeatureRows(tx, featureTables.redLine, projectId)
  await deleteFeatureRows(tx, featureTables.habitats, projectId)
  await deleteFeatureRows(tx, featureTables.hedgerows, projectId)
  await deleteFeatureRows(tx, featureTables.watercourses, projectId)
  await deleteFeatureRows(tx, featureTables.trees, projectId)
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

/**
 * Replace the baseline AND post-intervention documents and geometry rows for a
 * project, from one combined (baseline + post-intervention) file. Everything
 * happens in one transaction, so the two documents can never be stored from
 * different files.
 *
 * @param {import('drizzle-orm/node-postgres').NodePgDatabase} drizzle
 * @param {string} projectId
 * @param {{ baseline: { document: object, geometries: object }, postIntervention: { document: object, geometries: object } }} extracted
 * @param {object} context
 * @param {string} context.uploadId
 * @param {{ info: (msg: string) => void }} context.logger
 * @param {object} context.credentials verified token payload, as for persistUpload
 * @param {string} [context.uploadLabel]
 */
async function persistCombinedUpload(
  drizzle,
  projectId,
  { baseline, postIntervention },
  { uploadId, logger, credentials, uploadLabel = 'post-intervention' }
) {
  try {
    await drizzle.transaction(async (tx) => {
      await tx.execute(
        sql.raw(`SET LOCAL lock_timeout = '${PERSIST_LOCK_TIMEOUT}'`)
      )

      await assertProjectExistsForUpdate(tx, projectId, credentials)
      await deleteExistingFeatureRows(tx, projectId, BASELINE_FEATURE_TABLES)
      await deleteExistingFeatureRows(
        tx,
        projectId,
        POST_INTERVENTION_FEATURE_TABLES
      )
      await persistGeometryLayers(
        tx,
        projectId,
        baseline.geometries,
        BASELINE_FEATURE_TABLES
      )
      await persistGeometryLayers(
        tx,
        projectId,
        postIntervention.geometries,
        POST_INTERVENTION_FEATURE_TABLES
      )
      await setProjectBaselineAndPostIntervention(
        tx,
        projectId,
        {
          baseline: baseline.document,
          postIntervention: postIntervention.document
        },
        credentials.sub
      )
    })
  } catch (err) {
    rethrowPersistError(err, uploadLabel)
  }

  logger.info(
    `${uploadLabel}: persisted baseline and post-intervention for projectId ${projectId} from uploadId ${uploadId}`
  )
}

export { persistUpload, persistCombinedUpload }
