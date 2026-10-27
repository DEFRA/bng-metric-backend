import Boom from '@hapi/boom'
import { and, eq, sql } from 'drizzle-orm'

import { projects } from '../db/schema/index.js'
import { setProjectFeature } from '../db/persist-project.js'
import { setGeometryRefs } from '../db/feature-geometry-refs.js'
import { visibleToUser } from '../db/project-visibility.js'
import { PG_LOCK_NOT_AVAILABLE } from '../db/postgres-error-codes.js'
import {
  APPLY_RESULT,
  applyFeatureUpdate
} from '../utilities/features/apply-feature-update.js'
import {
  RETAINED_REF_RESULT,
  applyRetainedRefEdit
} from '../utilities/features/apply-retained-ref-edit.js'
import { listRenamedRefs } from '../utilities/features/renamed-refs.js'
import { outOfScopeDistinctivenessError } from './out-of-scope-error.js'
import {
  featureEditPayload,
  projectFeatureIdParams,
  retainedRefEditPayload
} from './shared-params.js'
import { featureByIdColumns, readFeatureMatch } from '../db/project-features.js'

/**
 * @openapi
 * /projects/{projectId}/features/{featureId}:
 *   get:
 *     tags:
 *       - Projects
 *     summary: Get a single baseline feature regardless of layer
 *     description: |
 *       Scans habitats, hedgerows and watercourses and returns the matching
 *       feature with a `type` discriminator. Lets the frontend address any
 *       baseline feature by featureId alone - the data tells the caller what
 *       kind of feature it is.
 *     parameters:
 *       - $ref: '#/components/parameters/ProjectId'
 *       - $ref: '#/components/parameters/FeatureId'
 *     responses:
 *       200:
 *         description: Returns the feature with its type
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 type:
 *                   type: string
 *                   enum: [habitat, tree, hedgerow, watercourse]
 *                 feature:
 *                   type: object
 *       404:
 *         description: Project or feature not found
 */
/**
 * @openapi
 * /projects/{projectId}/post-intervention/features/{featureId}:
 *   get:
 *     tags:
 *       - Projects
 *     summary: Get a single post-intervention feature regardless of layer
 *     description: |
 *       Scans post-intervention habitats, hedgerows and watercourses and
 *       returns the matching feature with a `type` discriminator. Lets the
 *       frontend address any post-intervention feature by featureId alone.
 *     parameters:
 *       - $ref: '#/components/parameters/ProjectId'
 *       - $ref: '#/components/parameters/FeatureId'
 *     responses:
 *       200:
 *         description: Returns the feature with its type
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 type:
 *                   type: string
 *                   enum: [habitat, tree, hedgerow, watercourse]
 *                 feature:
 *                   type: object
 *       404:
 *         description: Project or feature not found
 */
function createGetFeatureRoute({ path, documentKey }) {
  return {
    method: 'GET',
    path,
    options: {
      auth: 'defra-jwt',
      validate: {
        params: projectFeatureIdParams
      }
    },
    handler: async (request, _h) => {
      const credentials = request.auth.credentials
      const { projectId, featureId } = request.params
      // Item W4: Postgres searches the layers and returns just the matching
      // feature, so the whole document no longer crosses the wire to be parsed
      // here — see the header of src/db/project-features.js. A visible project
      // still returns a row when it holds no such feature, which is what keeps
      // the two 404s apart.
      const rows = await request.drizzle
        .select(featureByIdColumns({ documentKey, featureId }))
        .from(projects)
        .where(and(eq(projects.id, projectId), visibleToUser(credentials)))

      if (rows.length === 0) {
        throw Boom.notFound(`Project ${projectId} not found`)
      }

      const found = readFeatureMatch(rows[0], featureId)
      if (!found) {
        throw Boom.notFound(
          `Feature ${featureId} not found in project ${projectId}`
        )
      }
      return { type: found.type, feature: found.feature }
    }
  }
}

const getFeature = createGetFeatureRoute({
  path: '/projects/{projectId}/features/{featureId}',
  documentKey: 'baseline'
})

const getPostInterventionFeature = createGetFeatureRoute({
  path: '/projects/{projectId}/post-intervention/features/{featureId}',
  documentKey: 'postIntervention'
})

/**
 * @openapi
 * /projects/{projectId}/features/{featureId}:
 *   put:
 *     tags:
 *       - Projects
 *     summary: Save edits to one baseline feature
 *     description: |
 *       Persists the habitat reference (BMD-1061) and the habitat-type /
 *       condition (and broad-type for area habitats) selections, recomputes distinctiveness / condition score / units /
 *       status, refreshes the project-level units totals, then returns
 *       `{ type, feature }`. The feature type is discovered from the data,
 *       so a single endpoint handles habitats, hedgerows and watercourses.
 *       Watercourse edits also persist the watercourse/riparian encroachment
 *       selections and recompute units from the engine's encroachment
 *       multipliers (BMD-597).
 *
 *       `ref` is optional; leaving it out keeps the stored reference. When
 *       sent it follows the import rules (BMD-1058): a blank or
 *       whitespace-only value, or one that is not valid UTF-8, is a 400, and
 *       one longer than 100 characters is trimmed and truncated. A renamed
 *       reference is carried onto the post-intervention rows joined to the
 *       feature, and onto the stored geometry rows.
 *     parameters:
 *       - $ref: '#/components/parameters/ProjectId'
 *       - $ref: '#/components/parameters/FeatureId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ref:
 *                 type: string
 *                 description: Habitat reference (Parcel Ref)
 *               broadType:
 *                 type: string
 *                 nullable: true
 *               habitatType:
 *                 type: string
 *                 nullable: true
 *               condition:
 *                 type: string
 *                 nullable: true
 *               watercourseEncroachment:
 *                 type: string
 *                 nullable: true
 *               riparianEncroachment:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Returns the updated feature with its type
 *       400:
 *         description: Invalid payload (e.g. a blank habitat reference), or the feature type is not editable via this endpoint (e.g. an individual tree)
 *       404:
 *         description: Project or feature not found
 *       422:
 *         description: Habitat distinctiveness is out of scope for the BNG Beta service (High / V.High)
 *       409:
 *         description: Another edit for this project is in progress
 */
const updateFeature = {
  method: 'PUT',
  path: '/projects/{projectId}/features/{featureId}',
  options: {
    auth: 'defra-jwt',
    validate: {
      params: projectFeatureIdParams,
      payload: featureEditPayload
    }
  },
  handler: (request, _h) =>
    runInEditTransaction(request, (tx, context) =>
      runFeatureUpdate(tx, { ...context, edits: request.payload })
    )
}

/**
 * @openapi
 * /projects/{projectId}/post-intervention/features/{featureId}:
 *   put:
 *     tags:
 *       - Projects
 *     summary: Rename a retained post-intervention habitat
 *     description: |
 *       Saves a new habitat reference for a Retained post-intervention area
 *       habitat, hedgerow or watercourse (BMD-1180), and returns the
 *       post-intervention feature as `{ type, feature }`. Nothing else on a
 *       Retained habitat is editable.
 *
 *       The reference follows the import rules (BMD-1058): a blank or
 *       whitespace-only value, or one that is not valid UTF-8, is a 400, and
 *       one longer than 100 characters is trimmed and truncated.
 *
 *       A Retained habitat is joined to its baseline parcel by reference, so
 *       the rename is made to that parcel and carried onto every
 *       post-intervention row joined to it, as a baseline rename is
 *       (BMD-1061). A habitat linked to its parent by id (BNG Service template)
 *       or whose baseline parcel cannot be told apart is renamed alone. The
 *       stored geometry rows follow.
 *     parameters:
 *       - $ref: '#/components/parameters/ProjectId'
 *       - $ref: '#/components/parameters/FeatureId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ref]
 *             properties:
 *               ref:
 *                 type: string
 *                 description: Habitat reference (Parcel Ref)
 *     responses:
 *       200:
 *         description: Returns the renamed post-intervention feature with its type
 *       400:
 *         description: Invalid payload (e.g. a blank habitat reference), or the feature is not a Retained area habitat, hedgerow or watercourse
 *       404:
 *         description: Project or feature not found
 *       409:
 *         description: Another edit for this project is in progress
 */
const updatePostInterventionFeatureRef = {
  method: 'PUT',
  path: '/projects/{projectId}/post-intervention/features/{featureId}',
  options: {
    auth: 'defra-jwt',
    validate: {
      params: projectFeatureIdParams,
      payload: retainedRefEditPayload
    }
  },
  handler: (request, _h) =>
    runInEditTransaction(request, (tx, context) =>
      runRetainedRefUpdate(tx, { ...context, ref: request.payload.ref })
    )
}

/**
 * Run an edit in its own transaction, turning a lock that could not be taken
 * into a 409.
 *
 * @param {object} request
 * @param {(tx: object, context: object) => Promise<object>} run
 */
async function runInEditTransaction(request, run) {
  const context = {
    ...request.params,
    credentials: request.auth.credentials,
    logger: request.logger
  }
  try {
    return await request.drizzle.transaction((tx) => run(tx, context))
  } catch (err) {
    if (err?.isBoom) {
      throw err
    }
    if (err?.code === PG_LOCK_NOT_AVAILABLE) {
      throw Boom.conflict('Another edit for this project is in progress')
    }
    throw err
  }
}

/** Lock the project row for the edit, or 404 when the user cannot see it. */
async function lockVisibleProject(tx, projectId, credentials) {
  await tx.execute(sql`SET LOCAL lock_timeout = '5s'`)

  const [row] = await tx
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), visibleToUser(credentials)))
    .for('update')
    .limit(1)
  if (!row) {
    throw Boom.notFound(`Project ${projectId} not found`)
  }
  return row
}

/**
 * Write the edited feature, its document's totals and any re-derived
 * post-intervention document, then rename the geometry rows that follow.
 */
async function persistFeatureEdit(
  tx,
  { projectId, project, documentKey, result, actorId }
) {
  await setProjectFeature(tx, projectId, {
    documentKey,
    layer: result.layer,
    index: result.index,
    feature: result.feature,
    unitsTotals: result.unitsTotals,
    postIntervention: result.postIntervention,
    actorId
  })
  await setGeometryRefs(
    tx,
    projectId,
    listRenamedRefs(project, {
      documentKey,
      layer: result.layer,
      feature: result.feature,
      postIntervention: result.postIntervention
    })
  )
}

async function runFeatureUpdate(
  tx,
  { projectId, featureId, edits, credentials, logger }
) {
  const row = await lockVisibleProject(tx, projectId, credentials)

  const result = applyFeatureUpdate(row.project ?? {}, {
    featureId,
    edits,
    logger
  })
  if (result.status === APPLY_RESULT.FEATURE_NOT_FOUND) {
    throw Boom.notFound(
      `Feature ${featureId} not found in project ${projectId}`
    )
  }
  if (result.status === APPLY_RESULT.UNSUPPORTED_TYPE) {
    throw Boom.badRequest(
      `Feature type ${result.type} is not editable via this endpoint`
    )
  }
  if (result.status === APPLY_RESULT.OUT_OF_SCOPE) {
    throw outOfScopeDistinctivenessError(result.distinctiveness)
  }

  await persistFeatureEdit(tx, {
    projectId,
    project: row.project ?? {},
    documentKey: 'baseline',
    result,
    actorId: credentials.sub
  })

  return { type: result.type, feature: result.feature }
}

async function runRetainedRefUpdate(
  tx,
  { projectId, featureId, ref, credentials, logger }
) {
  const row = await lockVisibleProject(tx, projectId, credentials)

  const result = applyRetainedRefEdit(row.project ?? {}, {
    featureId,
    ref,
    logger
  })
  if (result.status === RETAINED_REF_RESULT.FEATURE_NOT_FOUND) {
    throw Boom.notFound(
      `Feature ${featureId} not found in project ${projectId}`
    )
  }
  if (result.status === RETAINED_REF_RESULT.NOT_RETAINED) {
    throw Boom.badRequest(
      'Only the reference of a Retained area habitat, hedgerow or watercourse can be edited via this endpoint'
    )
  }

  await persistFeatureEdit(tx, {
    projectId,
    project: row.project ?? {},
    documentKey: result.documentKey,
    result,
    actorId: credentials.sub
  })

  return { type: result.type, feature: result.postInterventionFeature }
}

export {
  getFeature,
  getPostInterventionFeature,
  updateFeature,
  updatePostInterventionFeatureRef
}
