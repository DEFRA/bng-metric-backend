import { calculatePostInterventionNetUnitChanges } from 'bng-metric-engine'
import { describe, expect, it } from 'vitest'

import { HTTP_OK } from './helpers/http-status.js'
import {
  BNG_SRID,
  FIXTURE,
  callPostInterventionValidate,
  callValidate,
  countLayer,
  createProject,
  fetchLayerRows,
  fetchProject,
  getPersistenceTestContext,
  registerPersistenceTestHooks,
  uploadFixture
} from './helpers/persistence-test-setup.js'

registerPersistenceTestHooks()

describe('POST /post-intervention/validate/{uploadId} - persistence and feature editing', () => {
  it('persists post-intervention data separately from baseline and supports feature read/edit', async () => {
    const { server, headers } = getPersistenceTestContext()
    const project = await createProject('Integration test - post intervention')
    const uploadId = await uploadFixture(FIXTURE)

    const res = await callPostInterventionValidate(uploadId, {
      projectId: project.id
    })

    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toEqual({ valid: true, errors: [] })

    const stored = await fetchProject(project.id)
    expect(stored.baseline).toBeUndefined()
    expect(stored.postIntervention).toBeDefined()
    expect(stored.postIntervention.uploadId).toBe(uploadId)
    expect(stored.postIntervention.habitats.length).toBeGreaterThan(0)
    expect(stored.postIntervention.hedgerows.length).toBeGreaterThan(0)
    expect(stored.postIntervention.watercourses.length).toBeGreaterThan(0)
    expect(stored.postIntervention.habitatSizes).toEqual(
      expect.objectContaining({
        areaHabitats: expect.any(Object),
        hedgerows: expect.any(Object),
        watercourses: expect.any(Object)
      })
    )
    expect(stored.postIntervention.units).toEqual(
      expect.objectContaining({
        habitatsTotal: expect.any(Number),
        hedgerowsTotal: expect.any(Number),
        watercoursesTotal: expect.any(Number),
        totalUnits: expect.any(Number)
      })
    )

    for (const feature of [
      ...stored.postIntervention.habitats,
      ...stored.postIntervention.trees,
      ...stored.postIntervention.hedgerows,
      ...stored.postIntervention.watercourses
    ]) {
      expect(['Complete', 'Incomplete']).toContain(feature.status)
      if (feature.status === 'Complete') {
        expect(typeof feature.units).toBe('number')
      }
    }

    expect(await countLayer('baseline_habitats', project.id)).toBe(0)
    expect(await countLayer('post_intervention_red_line', project.id)).toBe(1)
    const postInterventionRows = await fetchLayerRows(
      'post_intervention_habitats',
      project.id
    )
    const docFeatureIds = stored.postIntervention.habitats.map(
      (h) => h.featureId
    )
    expect(postInterventionRows).toHaveLength(docFeatureIds.length)
    expect(postInterventionRows.length).toBeGreaterThan(0)
    for (const row of postInterventionRows) {
      expect(row.srid).toBe(BNG_SRID)
      expect(row.is_valid).toBe(true)
      expect(row.geom_type).toBe('MULTIPOLYGON')
      expect(docFeatureIds).toContain(row.id)
    }

    const habitat = stored.postIntervention.habitats.find((h) => h.ref === 'H2')
    const featureRes = await server.inject({
      method: 'GET',
      url: `/projects/${project.id}/post-intervention/features/${habitat.featureId}`,
      headers
    })
    expect(featureRes.statusCode).toBe(HTTP_OK)
    expect(featureRes.result).toEqual({
      type: 'habitat',
      feature: habitat
    })

    const updateRes = await server.inject({
      method: 'PUT',
      url: `/projects/${project.id}/post-intervention/habitats/${habitat.featureId}`,
      headers,
      payload: {
        broadType: 'Grassland',
        habitatType: 'Other neutral grassland',
        condition: 'Good'
      }
    })
    expect(updateRes.statusCode).toBe(HTTP_OK)
    expect(updateRes.result).toEqual(
      expect.objectContaining({
        featureId: habitat.featureId,
        proposed: expect.objectContaining({
          broadType: 'Grassland',
          type: 'Other neutral grassland',
          condition: 'Good'
        }),
        status: 'Complete'
      })
    )

    const updated = await fetchProject(project.id)
    expect(updated.baseline).toBeUndefined()
    expect(
      updated.postIntervention.habitats.find(
        (h) => h.featureId === habitat.featureId
      )
    ).toEqual(updateRes.result)
  })

  it('calculates Enhanced linear units when baseline is uploaded before post-intervention', async () => {
    const project = await createProject(
      'Integration test — baseline then post-intervention'
    )
    const uploadId = await uploadFixture(FIXTURE)

    await callValidate(uploadId, { projectId: project.id })
    const baselineBefore = (await fetchProject(project.id)).baseline
    const piRes = await callPostInterventionValidate(uploadId, {
      projectId: project.id
    })
    expect(piRes.statusCode).toBe(HTTP_OK)

    const stored = await fetchProject(project.id)
    expect(stored.baseline).toEqual(baselineBefore)
    const enhancedLinear = [
      ...(stored.postIntervention.hedgerows ?? []),
      ...(stored.postIntervention.watercourses ?? [])
    ].filter((feature) => feature.retentionCategory === 'Enhanced')

    for (const feature of enhancedLinear) {
      expect(feature.status).toBe('Complete')
      expect(typeof feature.units).toBe('number')
      expect(feature.units).toBeGreaterThan(0)
    }
    expect(stored.postIntervention.units).toEqual(
      expect.objectContaining(
        calculatePostInterventionNetUnitChanges(
          stored.baseline.units,
          stored.postIntervention.units
        )
      )
    )
  })

  it('AC3 removes PI data if a baseline is uploaded into an invalid PI-only project', async () => {
    const project = await createProject(
      'Integration test — post-intervention then baseline'
    )
    const uploadId = await uploadFixture(FIXTURE)

    const piRes = await callPostInterventionValidate(uploadId, {
      projectId: project.id
    })
    expect(piRes.statusCode).toBe(HTTP_OK)

    let stored = await fetchProject(project.id)
    expect(stored.baseline).toBeUndefined()
    expect(stored.postIntervention).toBeDefined()

    await callValidate(uploadId, { projectId: project.id })

    stored = await fetchProject(project.id)
    expect(stored.baseline).toBeDefined()
    expect(stored.postIntervention).toBeUndefined()

    for (const table of [
      'post_intervention_red_line',
      'post_intervention_habitats',
      'post_intervention_hedgerows',
      'post_intervention_watercourses',
      'post_intervention_trees'
    ]) {
      expect(await countLayer(table, project.id)).toBe(0)
    }
  })

  it('AC6 replaces PI while leaving baseline unchanged', async () => {
    const project = await createProject(
      'Integration test - replace post-intervention'
    )
    const baselineUploadId = await uploadFixture(FIXTURE)
    await callValidate(baselineUploadId, { projectId: project.id })
    const baselineBefore = (await fetchProject(project.id)).baseline

    const firstPiUploadId = await uploadFixture(FIXTURE)
    await callPostInterventionValidate(firstPiUploadId, {
      projectId: project.id
    })
    const firstPiHabitats = await countLayer(
      'post_intervention_habitats',
      project.id
    )

    const secondPiUploadId = await uploadFixture(FIXTURE)
    await callPostInterventionValidate(secondPiUploadId, {
      projectId: project.id
    })

    const stored = await fetchProject(project.id)
    expect(stored.baseline).toEqual(baselineBefore)
    expect(stored.postIntervention.uploadId).toBe(secondPiUploadId)
    expect(secondPiUploadId).not.toBe(firstPiUploadId)
    expect(await countLayer('post_intervention_habitats', project.id)).toBe(
      firstPiHabitats
    )
    expect(await countLayer('post_intervention_red_line', project.id)).toBe(1)
  })
})
