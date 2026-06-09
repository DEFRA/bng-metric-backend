import Boom from '@hapi/boom'
import { eq, sql } from 'drizzle-orm'
import Joi from 'joi'

import {
  projects,
  baselineRedLine,
  baselineHabitats,
  baselineHedgerows,
  baselineWatercourses
} from '../db/schema/index.js'

const WGS84_SRID = 4326

function rowsToFeatureCollection(rows) {
  return {
    type: 'FeatureCollection',
    features: rows.map((row) => ({
      type: 'Feature',
      id: row.id,
      properties: { id: row.id, ref: row.ref ?? null },
      geometry: row.geometry
    }))
  }
}

async function selectLayer(
  drizzle,
  table,
  projectId,
  { includeRef = true } = {}
) {
  const refColumn = includeRef ? sql`, ref` : sql``
  const result = await drizzle.execute(sql`
    SELECT
      id::text AS id${refColumn},
      ST_AsGeoJSON(ST_Transform(geom, ${WGS84_SRID}::integer))::json AS geometry
    FROM ${table}
    WHERE project_id = ${projectId}::uuid
  `)
  return result.rows ?? result
}

/**
 * @openapi
 * /projects/{projectId}/baseline/geojson:
 *   get:
 *     tags:
 *       - Projects
 *     summary: GeoJSON FeatureCollections for the baseline spatial layers
 *     description: |
 *       Returns the persisted baseline geometries (red line, area habitats,
 *       hedgerows, watercourses) as GeoJSON FeatureCollections reprojected to
 *       EPSG:4326. Intended for browser map rendering — see BMD-546 spike.
 *     parameters:
 *       - $ref: '#/components/parameters/ProjectId'
 *     responses:
 *       200:
 *         description: Layers as GeoJSON FeatureCollections (WGS84)
 *       404:
 *         description: Project not found
 */
const getBaselineGeoJson = {
  method: 'GET',
  path: '/projects/{projectId}/baseline/geojson',
  options: {
    validate: {
      params: Joi.object({
        projectId: Joi.string().uuid().required()
      })
    }
  },
  handler: async (request, _h) => {
    const { projectId } = request.params

    const [project] = await request.drizzle
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
    if (!project) {
      throw Boom.notFound(`Project ${projectId} not found`)
    }

    const [redLineRows, habitatRows, hedgerowRows, watercourseRows] =
      await Promise.all([
        selectLayer(request.drizzle, baselineRedLine, projectId, {
          includeRef: false
        }),
        selectLayer(request.drizzle, baselineHabitats, projectId),
        selectLayer(request.drizzle, baselineHedgerows, projectId),
        selectLayer(request.drizzle, baselineWatercourses, projectId)
      ])

    return {
      crs: { type: 'name', properties: { name: 'EPSG:4326' } },
      redLine: redLineRows.length ? rowsToFeatureCollection(redLineRows) : null,
      areaHabitats: rowsToFeatureCollection(habitatRows),
      hedgerows: rowsToFeatureCollection(hedgerowRows),
      watercourses: rowsToFeatureCollection(watercourseRows)
    }
  }
}

export { getBaselineGeoJson }
