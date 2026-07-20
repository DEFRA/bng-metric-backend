import { describe, expect, it } from 'vitest'

import {
  copyRetainedProposedFromBaseline,
  RETAINED_AREA_PROPOSED_FIELDS,
  RETAINED_TREE_EMPTINESS_FIELDS,
  RETAINED_TREE_PROPOSED_FIELDS
} from './copy-retained-proposed-from-baseline.js'
import { RETENTION_RETAINED } from './retention-category.js'

function makeRetainedArea(overrides = {}) {
  return {
    retentionCategory: RETENTION_RETAINED,
    baseline: {
      type: 'Modified grassland',
      broadType: 'Grassland',
      condition: 'Moderate',
      strategicSignificance: 'Low significance'
    },
    proposed: {
      type: null,
      broadType: null,
      condition: null,
      strategicSignificance: null,
      advanceYears: 0,
      delayYears: 0
    },
    ...overrides
  }
}

describe('copyRetainedProposedFromBaseline', () => {
  it('copies baseline identity fields onto empty proposed for Retained', () => {
    const feature = makeRetainedArea()
    copyRetainedProposedFromBaseline(feature, {
      copyFields: RETAINED_AREA_PROPOSED_FIELDS
    })

    expect(feature.proposed).toEqual(
      expect.objectContaining({
        type: 'Modified grassland',
        broadType: 'Grassland',
        condition: 'Moderate',
        strategicSignificance: 'Low significance',
        advanceYears: 0,
        delayYears: 0
      })
    )
  })

  it('does nothing when retentionCategory is not Retained', () => {
    const feature = makeRetainedArea({ retentionCategory: 'Created' })
    copyRetainedProposedFromBaseline(feature, {
      copyFields: RETAINED_AREA_PROPOSED_FIELDS
    })

    expect(feature.proposed.type).toBeNull()
    expect(feature.proposed.condition).toBeNull()
  })

  it('does nothing when any proposed identity field is already present', () => {
    const feature = makeRetainedArea({
      proposed: {
        type: 'Developed land; sealed surface',
        broadType: null,
        condition: null,
        strategicSignificance: null,
        advanceYears: 0,
        delayYears: 0
      }
    })
    copyRetainedProposedFromBaseline(feature, {
      copyFields: RETAINED_AREA_PROPOSED_FIELDS
    })

    expect(feature.proposed.type).toBe('Developed land; sealed surface')
    expect(feature.proposed.broadType).toBeNull()
    expect(feature.proposed.condition).toBeNull()
  })

  it('treats N/A proposed strings as empty', () => {
    const feature = makeRetainedArea({
      proposed: {
        type: 'N/A',
        broadType: 'N/A',
        condition: 'N/A',
        strategicSignificance: 'N/A',
        advanceYears: 0,
        delayYears: 0
      }
    })
    copyRetainedProposedFromBaseline(feature, {
      copyFields: RETAINED_AREA_PROPOSED_FIELDS
    })

    expect(feature.proposed.condition).toBe('Moderate')
    expect(feature.proposed.type).toBe('Modified grassland')
  })

  it('does not copy when baseline or proposed sub-object is missing', () => {
    const feature = makeRetainedArea({ baseline: null })
    copyRetainedProposedFromBaseline(feature, {
      copyFields: RETAINED_AREA_PROPOSED_FIELDS
    })
    expect(feature.proposed.type).toBeNull()
  })

  it('treats zero and non-string proposed values as empty', () => {
    const feature = makeRetainedArea({
      proposed: {
        type: 0,
        broadType: { invalid: true },
        condition: null,
        strategicSignificance: null,
        advanceYears: 0,
        delayYears: 0
      }
    })
    copyRetainedProposedFromBaseline(feature, {
      copyFields: RETAINED_AREA_PROPOSED_FIELDS
    })

    expect(feature.proposed.type).toBe('Modified grassland')
    expect(feature.proposed.broadType).toBe('Grassland')
  })

  it('does not overwrite a partial proposed side', () => {
    const feature = makeRetainedArea({
      proposed: {
        type: null,
        broadType: 'Urban',
        condition: null,
        strategicSignificance: null,
        advanceYears: 0,
        delayYears: 0
      }
    })
    copyRetainedProposedFromBaseline(feature, {
      copyFields: RETAINED_AREA_PROPOSED_FIELDS
    })

    expect(feature.proposed.broadType).toBe('Urban')
    expect(feature.proposed.type).toBeNull()
  })

  it('for trees, ignores always-set broadType when deciding emptiness', () => {
    const feature = {
      retentionCategory: RETENTION_RETAINED,
      baseline: {
        type: 'Urban tree',
        broadType: 'Individual trees',
        condition: 'Moderate',
        strategicSignificance: 'Low significance',
        treeSize: 'Small',
        treeSpecies: 'Oak',
        ruralOrUrban: 'Urban',
        sizeSquareMetres: 41,
        area: 41
      },
      proposed: {
        type: null,
        broadType: 'Individual trees',
        condition: null,
        strategicSignificance: null,
        treeSize: null,
        treeSpecies: null,
        ruralOrUrban: null,
        sizeSquareMetres: null,
        area: null,
        advanceYears: 0,
        delayYears: 0
      }
    }

    copyRetainedProposedFromBaseline(feature, {
      copyFields: RETAINED_TREE_PROPOSED_FIELDS,
      emptinessFields: RETAINED_TREE_EMPTINESS_FIELDS
    })

    expect(feature.proposed).toEqual(
      expect.objectContaining({
        type: 'Urban tree',
        condition: 'Moderate',
        treeSize: 'Small',
        ruralOrUrban: 'Urban',
        sizeSquareMetres: 41,
        area: 41
      })
    )
  })
})
