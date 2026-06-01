import Boom from '@hapi/boom'
import { eq, sql } from 'drizzle-orm'

import { PG_LOCK_NOT_AVAILABLE } from '../../db/postgres-error-codes.js'
import {
  projects,
  baselineRedLine,
  baselineHabitats,
  baselineHedgerows,
  baselineWatercourses
} from '../../db/schema/index.js'
import { EPSG_BNG } from '../../validation/baseline/geopackage-constants.js'

/** Cap rows per INSERT to keep statement size bounded for PostGIS bulk loads. */
const INSERT_BATCH_SIZE = 500

/** Maximum wait for the project row lock during concurrent baseline uploads. */
const PERSIST_LOCK_TIMEOUT = '5s'

const BASELINE_FEATURE_TABLES = [
  baselineRedLine,
  baselineHabitats,
  baselineHedgerows,
  baselineWatercourses
]

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

async function insertRedLineRow(tx, projectId, row) {
  const geomJson = JSON.stringify(row.geometry)
  await tx.execute(sql`
    INSERT INTO ${baselineRedLine} (id, project_id, geom)
    VALUES (
      ${row.featureId}::uuid,
      ${projectId}::uuid,
      ${transformToBngMultiGeomSql(geomJson, row.srid)}
    )
  `)
}

async function deleteExistingBaselineRows(tx, projectId) {
  for (const table of BASELINE_FEATURE_TABLES) {
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

async function persistGeometryLayers(tx, projectId, geometries) {
  if (geometries.redLine) {
    await insertRedLineRow(tx, projectId, geometries.redLine)
  }
  await insertGeometryRowsBatched(
    tx,
    baselineHabitats,
    projectId,
    geometries.habitats
  )
  await insertGeometryRowsBatched(
    tx,
    baselineHedgerows,
    projectId,
    geometries.hedgerows
  )
  await insertGeometryRowsBatched(
    tx,
    baselineWatercourses,
    projectId,
    geometries.watercourses
  )
}

async function updateProjectBaselineDocument(tx, projectId, document) {
  const docJson = JSON.stringify(document)
  await tx
    .update(projects)
    .set({
      project: sql`jsonb_set(${projects.project}, '{baseline}', ${docJson}::jsonb, true)`
    })
    .where(eq(projects.id, projectId))
}

async function runPersistTransaction(drizzle, projectId, document, geometries) {
  await drizzle.transaction(async (tx) => {
    await tx.execute(
      sql.raw(`SET LOCAL lock_timeout = '${PERSIST_LOCK_TIMEOUT}'`)
    )

    await assertProjectExistsForUpdate(tx, projectId)
    await deleteExistingBaselineRows(tx, projectId)
    await persistGeometryLayers(tx, projectId, geometries)
    await updateProjectBaselineDocument(tx, projectId, document)
  })
}

function rethrowPersistError(err) {
  if (err?.isBoom) {
    throw err
  } else if (err?.code === PG_LOCK_NOT_AVAILABLE) {
    throw Boom.conflict(
      'Another baseline upload for this project is in progress'
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
  { uploadId, logger }
) {
  try {
    await runPersistTransaction(drizzle, projectId, document, geometries)
  } catch (err) {
    rethrowPersistError(err)
  }

  logger.info(
    `validateBaseline: persisted baseline for projectId ${projectId} from uploadId ${uploadId}`
  )
}

export { persistBaseline }
