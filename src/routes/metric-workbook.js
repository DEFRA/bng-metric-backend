import Boom from '@hapi/boom'
import { and, eq } from 'drizzle-orm'
import Joi from 'joi'

import { projects } from '../db/schema/index.js'
import { visibleToUser } from '../db/project-visibility.js'
import {
  METRIC_FORMATS,
  METRIC_RELEASE,
  buildMetricWorkbook
} from '../services/metric-workbook/build-metric-workbook.js'

/**
 * @openapi
 * /projects/{projectId}/metric.{format}:
 *   get:
 *     tags:
 *       - Projects
 *     summary: Download the project as a filled-in Statutory Biodiversity Metric
 *     description: |
 *       Fills a copy of the Statutory Biodiversity Metric 1.1.1 with the
 *       project's on-site features (BMD-1141) and returns it: the
 *       macro-enabled workbook for `xlsm`, the macro-free one for `xlsx`.
 *
 *       Every on-site baseline habitat, hedgerow, watercourse, individual
 *       tree and vertical area habitat is a row, placed by what becomes of
 *       it, and every created or enhanced one a row on its creation or
 *       enhancement sheet, with the user's own reference in the metric's
 *       habitat reference column. The Start sheet carries the project's
 *       details. The off-site sheets are left empty. Only input cells are
 *       written: the metric's formulas, macros and sheet protection are as
 *       Defra published them, and Excel recalculates every formula when the
 *       file is opened.
 *
 *       A project whose features are not all complete is still downloaded,
 *       with its incomplete rows as they stand. A project with no baseline
 *       returns 404. The client names the file; the `content-disposition`
 *       here gives only a generic one.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/ProjectId'
 *       - name: format
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           enum: [xlsm, xlsx]
 *         description: The macro-enabled (`xlsm`) or macro-free (`xlsx`) workbook.
 *     responses:
 *       200:
 *         description: The workbook
 *         content:
 *           application/vnd.ms-excel.sheet.macroEnabled.12:
 *             schema:
 *               type: string
 *               format: binary
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: No valid session
 *       404:
 *         description: No such project for this user, or it has no baseline
 *       429:
 *         description: Too many downloads in the window
 */
const getProjectMetricWorkbook = {
  method: 'GET',
  path: '/projects/{projectId}/metric.{format}',
  options: {
    auth: 'defra-jwt',
    validate: {
      params: Joi.object({
        projectId: Joi.string().uuid().required(),
        format: Joi.string()
          .valid(...Object.keys(METRIC_FORMATS))
          .required()
      })
    }
  },
  handler: async (request, h) => {
    const { projectId, format } = request.params
    const started = performance.now()

    const rows = await request.drizzle
      .select({ project: projects.project })
      .from(projects)
      .where(
        and(eq(projects.id, projectId), visibleToUser(request.auth.credentials))
      )
      .limit(1)

    if (rows.length === 0) {
      throw Boom.notFound(`Project ${projectId} not found`)
    }
    const { project } = rows[0]
    // The frontend offers the download only once a baseline exists, so
    // reaching here without one is a hand-typed URL (BMD-1141 AC11).
    if (!project?.baseline) {
      throw Boom.notFound(`Project ${projectId} has no baseline`)
    }

    const workbook = await buildMetricWorkbook(project, { format })

    // The project ID, the format, the time and the size: nothing that
    // identifies the user (BMD-1141).
    request.logger.info(
      {
        projectId,
        format,
        metricRelease: METRIC_RELEASE,
        ms: Math.round(performance.now() - started),
        bytes: workbook.length
      },
      'metric workbook generated'
    )

    return h
      .response(workbook)
      .type(METRIC_FORMATS[format].contentType)
      .header('content-disposition', `attachment; filename="metric.${format}"`)
  }
}

export { getProjectMetricWorkbook }
