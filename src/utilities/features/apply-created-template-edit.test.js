import { test, expect } from 'vitest'
import { applyFeatureUpdate } from './apply-feature-update.js'

test.each([
  [
    'habitat',
    'habitats',
    { sizeSquareMetres: 10000, area: 10000 },
    { broadType: 'Grassland', type: 'Modified grassland' }
  ],
  ['hedgerow', 'hedgerows', { sizeMetres: 1000 }, { type: 'Native hedgerow' }]
])(
  'keeps template Created %s edits surgical and siblings unchanged',
  (type, layer, size, habitat) => {
    const featureId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    const row = {
      featureId,
      ref: 'Original',
      parentFeatureId: null,
      retentionCategory: 'Created',
      ...size,
      baseline: {},
      proposed: {
        ...habitat,
        condition: 'Poor',
        strategicSignificance: 'Low',
        advanceYears: 0,
        delayYears: 0
      },
      units: 1,
      status: 'Complete'
    }
    const sibling = {
      ...structuredClone(row),
      featureId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      ref: 'Sibling',
      units: 7.25
    }
    const project = {
      baseline: { habitats: [], hedgerows: [], watercourses: [], units: {} },
      postIntervention: {
        habitats: [],
        hedgerows: [],
        watercourses: [],
        trees: [],
        [layer]: [row, sibling],
        template: { name: 'bng-service', version: '1.0' }
      }
    }
    const legacy = structuredClone(project)
    delete legacy.postIntervention.template
    const edit = {
      featureId,
      expectedType: type,
      documentKey: 'postIntervention',
      edits: {
        ref: 'Renamed',
        broadType: habitat.broadType,
        habitatType: habitat.type,
        condition: 'Good',
        strategicSignificance: 'Low',
        advanceYears: 0,
        delayYears: 0
      }
    }
    const result = applyFeatureUpdate(project, edit)
    const previousPath = applyFeatureUpdate(legacy, edit)
    expect(result.status).toBe('ok')
    expect(result.postIntervention).toBeNull()
    expect(result.feature).toEqual(previousPath.feature)
    expect(result.unitsTotals).toEqual(previousPath.unitsTotals)
    expect(result.project.postIntervention[layer][1]).toEqual(sibling)
    expect(result.lostHabitats).toEqual([])
  }
)
