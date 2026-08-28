import Boom from '@hapi/boom'
import { and, eq } from 'drizzle-orm'
import Joi from 'joi'

import { projects } from '../db/schema/index.js'
import { visibleToUser } from '../db/project-visibility.js'
import {
  BASEMAP_CHOICES,
  DEFAULT_BASEMAP,
  buildSiteReport
} from '../services/report/build-site-report.js'

const CONTENT_TYPE_PDF = 'application/pdf'

/**
 * A filename a user can find again on their own machine.
 *
 * Anything outside a conservative set is replaced rather than stripped, so two
 * differently-named projects cannot collapse to the same filename. The header
 * is ASCII-only by construction, which avoids needing RFC 5987 encoding for a
 * value the user will rename anyway.
 */
const UNSAFE_FILENAME_CHARS = /[^a-zA-Z0-9-_ ]/g
const HAS_A_LETTER_OR_DIGIT = /[a-zA-Z0-9]/
const MAX_FILENAME_LENGTH = 80
const FALLBACK_FILENAME = 'bng-site'

function reportFilename(siteName) {
  const cleaned = String(siteName ?? '')
    .replaceAll(UNSAFE_FILENAME_CHARS, '-')
    .trim()
    .slice(0, MAX_FILENAME_LENGTH)

  // A name that survived as nothing but punctuation ("///" → "---") is worse
  // than no name at all, so it falls back too.
  const usable = HAS_A_LETTER_OR_DIGIT.test(cleaned)
    ? cleaned
    : FALLBACK_FILENAME
  return `${usable}-report.pdf`
}

/**
 * @openapi
 * /projects/{projectId}/report.pdf:
 *   get:
 *     tags:
 *       - Projects
 *     summary: Generate the site report for a project as a tagged PDF
 *     description: |
 *       Renders a printable, screen-reader-structured site report: the site on
 *       a map with its habitat parcels drawn over it, the key figures, and one
 *       row per parcel carrying a thumbnail and the recorded attributes.
 *
 *       Geometry is read from the project's stored PostGIS features — the copy
 *       the user has since edited — not from the uploaded GeoPackage, which can
 *       be stale. Sizes, habitat types and conditions come from the project
 *       document so the report agrees with the screens it was generated from.
 *
 *       The response is the PDF bytes, with a `content-disposition` naming a
 *       file. A project with no baseline has nothing to report on and returns
 *       404.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/ProjectId'
 *       - name: basemap
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           enum: [vector, raster]
 *           default: vector
 *         description: |
 *           Which Ordnance Survey basemap to draw under the habitat geometry.
 *           `vector` (the default) draws OS NGD API – Tiles geometry as
 *           crisp PDF paths; `raster` places OS Maps API PNG tiles as
 *           images. The two need different OS Data Hub products on the
 *           deployment's key, so the one your key lacks degrades to a plain
 *           ground rather than failing the report. Both exist side by side
 *           so the outputs can be compared like for like.
 *     responses:
 *       200:
 *         description: The generated report
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Project not found, or it holds no baseline yet
 */
const getProjectReport = {
  method: 'GET',
  path: '/projects/{projectId}/report.pdf',
  options: {
    auth: 'defra-jwt',
    validate: {
      params: Joi.object({
        projectId: Joi.string().uuid().required()
      }),
      query: Joi.object({
        basemap: Joi.string()
          .valid(...BASEMAP_CHOICES)
          .default(DEFAULT_BASEMAP)
      })
    }
  },
  handler: async (request, h) => {
    const { projectId } = request.params
    const started = performance.now()

    const rows = await request.drizzle
      .select({ id: projects.id, project: projects.project })
      .from(projects)
      .where(
        and(eq(projects.id, projectId), visibleToUser(request.auth.credentials))
      )
      .limit(1)

    if (rows.length === 0) {
      throw Boom.notFound(`Project ${projectId} not found`)
    }

    // A project with no baseline has no geometry and no habitats — there is
    // nothing to draw. The frontend keeps users off this route until a
    // baseline exists, so reaching it means a hand-typed URL rather than a
    // journey; 404 is the honest answer either way.
    if (!rows[0].project?.baseline) {
      throw Boom.notFound(`Project ${projectId} has no baseline to report on`)
    }

    const { pdf, stats, siteName } = await buildSiteReport({
      drizzle: request.drizzle,
      projectRow: rows[0],
      osTiles: request.server.app.osTiles ?? null,
      basemap: request.query.basemap
    })

    // Deliberately not routed through perf-evidence.js: that helper is spike
    // instrumentation with a stated expiry (BMD-869), and how long a report
    // takes, how large it is and how many tiles it cost are operational facts
    // worth keeping after the spike's lines are deleted.
    request.logger.info(
      {
        projectId,
        basemap: request.query.basemap,
        ms: Math.round(performance.now() - started),
        bytes: pdf.length,
        ...stats
      },
      'site report generated'
    )

    return h
      .response(pdf)
      .type(CONTENT_TYPE_PDF)
      .header(
        'content-disposition',
        `attachment; filename="${reportFilename(siteName)}"`
      )
  }
}

export { getProjectReport, reportFilename }
