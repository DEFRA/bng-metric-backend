import Boom from '@hapi/boom'
import { eq, sql } from 'drizzle-orm'

import { PG_LOCK_NOT_AVAILABLE } from '../../db/postgres-error-codes.js'
import {
  projects,
  baselineRedLine,
  baselineHabitats,
  baselineHedgerows,
  baselineWatercourses,
  postInterventionRedLine,
  postInterventionHabitats,
  postInterventionHedgerows,
  postInterventionWatercourses
} from '../../db/schema/index.js'
import { EPSG_BNG } from '../../validation/baseline/geopackage-constants.js'

/** Cap rows per INSERT to keep statement size bounded for PostGIS bulk loads. */
const INSERT_BATCH_SIZE = 500

/** Maximum wait for the project row lock during concurrent baseline uploads. */
const PERSIST_LOCK_TIMEOUT = '5s'

const BASELINE_FEATURE_TABLES = Object.freeze({
  redLine: baselineRedLine,
  habitats: baselineHabitats,
  hedgerows: baselineHedgerows,
  watercourses: baselineWatercourses
})

const POST_INTERVENTION_FEATURE_TABLES = Object.freeze({
  redLine: postInterventionRedLine,
  habitats: postInterventionHabitats,
  hedgerows: postInterventionHedgerows,
  watercourses: postInterventionWatercourses
})

const FEATURE_TABLE_SETS = Object.freeze({
  baseline: BASELINE_FEATURE_TABLES,
  postIntervention: POST_INTERVENTION_FEATURE_TABLES
})

function transformToBngMultiGeomSql(geomJson, sourceSrid) {
  return sql`ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), ${sourceSrid}), ${sql.raw(String(EPSG_BNG))}))`
}

function geometryRowValues(projectId, row) {
  const geomJson = JSON.stringify(row.geometry)
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
  const geomJson = JSON.stringify(row.geometry)
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

async function assertProjectExistsForUpdate(tx, projectId) {
  const projectRows = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
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
}

async function updateProjectDocumentSection(
  tx,
  projectId,
  document,
  projectDocumentKey
) {
  const docJson = JSON.stringify(document)
  await tx
    .update(projects)
    .set({
      project: sql`jsonb_set(${projects.project}, ${[projectDocumentKey]}::text[], ${docJson}::jsonb, true)`
    })
    .where(eq(projects.id, projectId))
}

async function runPersistTransaction(
  drizzle,
  projectId,
  document,
  geometries,
  { projectDocumentKey, featureTables }
) {
  await drizzle.transaction(async (tx) => {
    await tx.execute(
      sql.raw(`SET LOCAL lock_timeout = '${PERSIST_LOCK_TIMEOUT}'`)
    )

    await assertProjectExistsForUpdate(tx, projectId)
    await deleteExistingFeatureRows(tx, projectId, featureTables)
    await persistGeometryLayers(tx, projectId, geometries, featureTables)
    await updateProjectDocumentSection(
      tx,
      projectId,
      document,
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
 */
async function persistBaseline(
  drizzle,
  projectId,
  document,
  geometries,
  {
    uploadId,
    logger,
    projectDocumentKey = 'baseline',
    uploadLabel = 'baseline',
    featureTables = FEATURE_TABLE_SETS[projectDocumentKey]
  }
) {
  try {
    await runPersistTransaction(drizzle, projectId, document, geometries, {
      projectDocumentKey,
      featureTables
    })
  } catch (err) {
    rethrowPersistError(err, uploadLabel)
  }

  logger.info(
    `${uploadLabel}: persisted ${uploadLabel} for projectId ${projectId} from uploadId ${uploadId}`
  )
}

export { persistBaseline, FEATURE_TABLE_SETS }
