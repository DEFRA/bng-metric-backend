import { calculatePostInterventionNetUnitChanges } from 'bng-library/metric'
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
  fetchProjectAudit,
  fetchProject,
  getPersistenceTestContext,
  registerPersistenceTestHooks,
  uploadFixture
} from './helpers/persistence-test-setup.js'

registerPersistenceTestHooks()

const COMBINED_FIXTURE = 'post-intervention-combined.gpkg'

describe('POST /post-intervention/validate/{uploadId} - persistence and feature editing', () => {
  it('persists post-intervention data separately from baseline and supports feature read/edit', async () => {
    const { server, headers, userId } = getPersistenceTestContext()
    const project = await createProject('Integration test - post intervention')
    const uploadId = await uploadFixture(FIXTURE)

    const res = await callPostInterventionValidate(uploadId, {
      projectId: project.id
    })

    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toEqual({ valid: true, errors: [] })

    const stored = await fetchProject(project.id)
    expect(stored.baseline.uploadId).toBe(uploadId)
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

    let auditRows = await fetchProjectAudit(project.id)
    const uploadAudit = auditRows.at(-1)
    expect(uploadAudit).toMatchObject({
      operation: 'UPDATE',
      user_id: userId
    })
    expect(uploadAudit.project.postIntervention.uploadId).toBe(uploadId)
    expect(uploadAudit.previous_project.postIntervention).toBeUndefined()

    expect(await countLayer('baseline_habitats', project.id)).toBe(
      stored.baseline.habitats.length
    )
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
    // H2 is Enhanced with a blank Proposed Strategic Significance in the
    // fixture, so it's rejected (BMD-1051): the edit is saved, but the habitat
    // stays at zero units and Incomplete until a valid value is chosen.
    expect(updateRes.result).toEqual(
      expect.objectContaining({
        featureId: habitat.featureId,
        proposed: expect.objectContaining({
          broadType: 'Grassland',
          type: 'Other neutral grassland',
          condition: 'Good',
          strategicSignificance: null
        }),
        units: 0,
        status: 'Incomplete'
      })
    )

    const updated = await fetchProject(project.id)
    expect(updated.baseline).toEqual(stored.baseline)
    expect(
      updated.postIntervention.habitats.find(
        (h) => h.featureId === habitat.featureId
      )
    ).toEqual(updateRes.result)

    auditRows = await fetchProjectAudit(project.id)
    const featureAudit = auditRows.at(-1)
    expect(featureAudit).toMatchObject({
      operation: 'UPDATE',
      user_id: userId
    })
    expect(
      featureAudit.project.postIntervention.habitats.find(
        (feature) => feature.featureId === habitat.featureId
      )
    ).toEqual(updateRes.result)
    expect(featureAudit.previous_project).not.toEqual(featureAudit.project)
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

    // The baseline is re-derived from the same rows, so only the import time moves.
    const stored = await fetchProject(project.id)
    expect({ ...stored.baseline, importedAt: null }).toEqual({
      ...baselineBefore,
      importedAt: null
    })
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

  it('AC4 removes PI data when a baseline is uploaded over a baseline and PI', async () => {
    const project = await createProject(
      'Integration test — post-intervention then baseline'
    )
    const uploadId = await uploadFixture(FIXTURE)

    const piRes = await callPostInterventionValidate(uploadId, {
      projectId: project.id
    })
    expect(piRes.statusCode).toBe(HTTP_OK)

    let stored = await fetchProject(project.id)
    expect(stored.baseline).toBeDefined()
    expect(stored.postIntervention).toBeDefined()

    const baselineUploadId = await uploadFixture(FIXTURE)
    await callValidate(baselineUploadId, { projectId: project.id })

    stored = await fetchProject(project.id)
    expect(stored.baseline.uploadId).toBe(baselineUploadId)
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

  it('AC7 replaces both the baseline and PI on a second PI upload', async () => {
    const project = await createProject(
      'Integration test - replace post-intervention'
    )
    const baselineUploadId = await uploadFixture(FIXTURE)
    await callValidate(baselineUploadId, { projectId: project.id })

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
    expect(stored.baseline.uploadId).toBe(secondPiUploadId)
    expect(stored.postIntervention.uploadId).toBe(secondPiUploadId)
    expect(secondPiUploadId).not.toBe(firstPiUploadId)
    expect(await countLayer('post_intervention_habitats', project.id)).toBe(
      firstPiHabitats
    )
    expect(await countLayer('baseline_habitats', project.id)).toBe(
      stored.baseline.habitats.length
    )
    expect(await countLayer('post_intervention_red_line', project.id)).toBe(1)
    expect(await countLayer('baseline_red_line', project.id)).toBe(1)
  })
})

describe('POST /post-intervention/validate/{uploadId} - combined file derives the baseline', () => {
  const refs = (features) => features.map((feature) => feature.ref).sort()

  // Rows in COMBINED_FIXTURE whose Retention Category is Created or Lost.
  const CREATED_HEDGEROWS = ['HG005', 'HG010', 'HG013', 'HG018']
  const LOST_HEDGEROWS = ['HG001', 'HG002', 'HG003', 'HG011', 'HG014']
  const LOST_TREES = [
    'T001',
    'T006',
    'T009',
    'T010',
    'T015',
    'T016',
    'T019',
    'T022'
  ]

  it('AC5 creates the baseline from Lost, Retained and Enhanced rows and the PI from Retained, Enhanced and Created', async () => {
    const project = await createProject('Integration test - combined file')
    const uploadId = await uploadFixture(COMBINED_FIXTURE)

    const res = await callPostInterventionValidate(uploadId, {
      projectId: project.id
    })
    expect(res.statusCode).toBe(HTTP_OK)
    expect(res.result).toEqual({ valid: true, errors: [] })

    const { baseline, postIntervention } = await fetchProject(project.id)
    expect(baseline.uploadId).toBe(uploadId)

    // Every area row has a baseline habitat, Lost parcels included.
    expect(baseline.habitats).toHaveLength(55)
    // Lost features stay in the baseline; Created ones never enter it.
    expect(baseline.hedgerows).toHaveLength(14)
    expect(refs(baseline.hedgerows)).toEqual(
      expect.arrayContaining(LOST_HEDGEROWS)
    )
    for (const ref of CREATED_HEDGEROWS) {
      expect(refs(baseline.hedgerows)).not.toContain(ref)
    }
    expect(refs(baseline.watercourses)).toEqual(['R001', 'R002'])
    expect(baseline.trees).toHaveLength(26)
    expect(refs(baseline.trees)).toEqual(expect.arrayContaining(LOST_TREES))
    expect(refs(baseline.trees)).not.toContain('T005')
    expect(baseline.units.totalUnits).toBeGreaterThan(0)

    // The post-intervention document drops Lost linear features and trees as before.
    expect(postIntervention.hedgerows).toHaveLength(13)
    expect(refs(postIntervention.hedgerows)).toEqual(
      expect.arrayContaining(CREATED_HEDGEROWS)
    )
    expect(refs(postIntervention.watercourses)).toEqual(['R001', 'R003'])
    expect(postIntervention.trees).toHaveLength(19)
    expect(postIntervention.units).toEqual(
      expect.objectContaining(
        calculatePostInterventionNetUnitChanges(
          baseline.units,
          postIntervention.units
        )
      )
    )

    for (const [table, features] of [
      ['baseline_habitats', baseline.habitats],
      ['baseline_hedgerows', baseline.hedgerows],
      ['baseline_watercourses', baseline.watercourses],
      ['baseline_trees', baseline.trees],
      ['post_intervention_hedgerows', postIntervention.hedgerows],
      ['post_intervention_watercourses', postIntervention.watercourses],
      ['post_intervention_trees', postIntervention.trees]
    ]) {
      expect(await countLayer(table, project.id)).toBe(features.length)
    }
    expect(await countLayer('baseline_red_line', project.id)).toBe(1)
  })

  it('AC6 replaces an existing baseline with the one derived from the PI file', async () => {
    const project = await createProject(
      'Integration test - combined file over a baseline'
    )
    const baselineUploadId = await uploadFixture(FIXTURE)
    await callValidate(baselineUploadId, { projectId: project.id })

    const uploadId = await uploadFixture(COMBINED_FIXTURE)
    await callPostInterventionValidate(uploadId, { projectId: project.id })

    const { baseline, postIntervention } = await fetchProject(project.id)
    expect(baseline.uploadId).toBe(uploadId)
    expect(postIntervention.uploadId).toBe(uploadId)
    expect(await countLayer('baseline_habitats', project.id)).toBe(55)
  })

  it('AC2 ignores the PI rows when a combined file is uploaded as a baseline', async () => {
    const project = await createProject(
      'Integration test - combined file as baseline'
    )
    const uploadId = await uploadFixture(COMBINED_FIXTURE)

    const res = await callValidate(uploadId, { projectId: project.id })
    expect(res.statusCode).toBe(HTTP_OK)

    const stored = await fetchProject(project.id)
    expect(stored.postIntervention).toBeUndefined()
    expect(stored.baseline.hedgerows).toHaveLength(14)
    expect(refs(stored.baseline.watercourses)).toEqual(['R001', 'R002'])
    expect(refs(stored.baseline.trees)).not.toContain('T005')
    expect(await countLayer('post_intervention_habitats', project.id)).toBe(0)
  })
})
