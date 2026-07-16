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
        habitatType: 'Lowland meadows',
        condition: 'Good'
      }
    })
    expect(updateRes.statusCode).toBe(HTTP_OK)
    expect(updateRes.result).toEqual(
      expect.objectContaining({
        featureId: habitat.featureId,
        proposed: expect.objectContaining({
          broadType: 'Grassland',
          type: 'Lowland meadows',
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
    const piRes = await callPostInterventionValidate(uploadId, {
      projectId: project.id
    })
    expect(piRes.statusCode).toBe(HTTP_OK)

    const stored = await fetchProject(project.id)
    const enhancedLinear = [
      ...(stored.postIntervention.hedgerows ?? []),
      ...(stored.postIntervention.watercourses ?? [])
    ].filter((feature) => feature.retentionCategory === 'Enhanced')

    for (const feature of enhancedLinear) {
      expect(feature.status).toBe('Complete')
      expect(typeof feature.units).toBe('number')
      expect(feature.units).toBeGreaterThan(0)
    }
  })

  it('re-enriches Enhanced linear features when baseline is uploaded after post-intervention', async () => {
    const project = await createProject(
      'Integration test — post-intervention then baseline'
    )
    const uploadId = await uploadFixture(FIXTURE)

    const piRes = await callPostInterventionValidate(uploadId, {
      projectId: project.id
    })
    expect(piRes.statusCode).toBe(HTTP_OK)

    let stored = await fetchProject(project.id)
    const enhancedBefore = [
      ...(stored.postIntervention?.watercourses ?? []),
      ...(stored.postIntervention?.hedgerows ?? [])
    ].filter((feature) => feature.retentionCategory === 'Enhanced')

    for (const feature of enhancedBefore) {
      expect(feature.status).toBe('Incomplete')
    }

    await callValidate(uploadId, { projectId: project.id })

    stored = await fetchProject(project.id)
    const enhancedAfter = [
      ...(stored.postIntervention?.watercourses ?? []),
      ...(stored.postIntervention?.hedgerows ?? [])
    ].filter((feature) => feature.retentionCategory === 'Enhanced')

    expect(enhancedAfter).toHaveLength(enhancedBefore.length)
    for (const feature of enhancedAfter) {
      expect(feature.status).toBe('Complete')
      expect(typeof feature.units).toBe('number')
      expect(feature.units).toBeGreaterThan(0)
    }
  })
})
