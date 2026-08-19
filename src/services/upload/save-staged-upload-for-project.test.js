// Unit tests for the pure helpers of the staged persistence path. The whole
// path — transform, size, extract, enrich, persist — is proven end to end by
// integration-tests/staged-persistence.test.js; these tests pin the mapping
// rules that must not drift.
import { describe, expect, it } from 'vitest'

import { HABITAT_TYPES } from '../../validation/geopackage/lineage/staged-layer-names.js'
import {
  extendBaselineLengthsForEnhancedChildren,
  removedHabitatsFromReport,
  stagedStoredShapeFromProject
} from './save-staged-upload-for-project.js'

describe('removedHabitatsFromReport', () => {
  it('maps the reconcileParents report onto the seam-contract camelCase shape', () => {
    const report = [
      {
        type: 'hedgerows',
        parent_ref: 'HR-1',
        measure: 'length',
        baseline_size: 200,
        pi_size: 100,
        removed_size: 100
      },
      {
        type: 'trees',
        parent_ref: 'T-2',
        measure: 'count',
        baseline_size: 1,
        pi_size: 0,
        removed_size: 1
      }
    ]

    expect(removedHabitatsFromReport(report)).toEqual([
      {
        type: 'hedgerows',
        parentRef: 'HR-1',
        measure: 'length',
        baselineSize: 200,
        removedSize: 100
      },
      {
        type: 'trees',
        parentRef: 'T-2',
        measure: 'count',
        baselineSize: 1,
        removedSize: 1
      }
    ])
  })

  it('returns an empty array for an empty or absent report', () => {
    expect(removedHabitatsFromReport([])).toEqual([])
    expect(removedHabitatsFromReport()).toEqual([])
  })
})

describe('extendBaselineLengthsForEnhancedChildren', () => {
  const enhancedChild = (piRef, parentRef) => ({
    piRef,
    parentRef,
    retentionCategory: 'Enhanced'
  })

  it('maps an Enhanced child ref to its stamped parent baseline length', () => {
    const lengths = new Map([['HR-1', 0.2]])

    const added = extendBaselineLengthsForEnhancedChildren(lengths, {
      [HABITAT_TYPES.HEDGEROWS]: [enhancedChild('HR-1b', 'HR-1')]
    })

    expect(lengths.get('HR-1b')).toBe(0.2)
    expect(added).toEqual([
      { type: HABITAT_TYPES.HEDGEROWS, childRef: 'HR-1b', parentRef: 'HR-1' }
    ])
  })

  it('leaves a child whose own ref already resolves alone', () => {
    // The fixture's Enhanced watercourse WC-1 keeps its parent's ref, so the
    // ordinary lookup already works and nothing must be overwritten.
    const lengths = new Map([['WC-1', 0.1]])

    const added = extendBaselineLengthsForEnhancedChildren(lengths, {
      [HABITAT_TYPES.WATERCOURSES]: [enhancedChild('WC-1', 'WC-1')]
    })

    expect(added).toEqual([])
    expect(lengths.get('WC-1')).toBe(0.1)
  })

  it('ignores non-Enhanced children, missing parents, and unstamped rows', () => {
    const lengths = new Map([['HR-1', 0.2]])

    const added = extendBaselineLengthsForEnhancedChildren(lengths, {
      [HABITAT_TYPES.HEDGEROWS]: [
        { piRef: 'HR-1a', parentRef: 'HR-1', retentionCategory: 'Retained' },
        enhancedChild('HR-9b', 'HR-9'),
        { piRef: 'HR-1c', parentRef: null, retentionCategory: 'Enhanced' },
        // a brand-new planting: Created and parentless — must never trigger
        // the Enhanced baseline-length lookup
        { piRef: 'HR-NEW-1', parentRef: null, retentionCategory: 'Created' }
      ]
    })

    expect(added).toEqual([])
    expect([...lengths.keys()]).toEqual(['HR-1'])
  })

  it('accepts the numbered retention prefix the template writes', () => {
    const lengths = new Map([['HR-1', 0.2]])

    extendBaselineLengthsForEnhancedChildren(lengths, {
      [HABITAT_TYPES.HEDGEROWS]: [
        { piRef: 'HR-1b', parentRef: 'HR-1', retentionCategory: '3. Enhanced' }
      ]
    })

    expect(lengths.get('HR-1b')).toBe(0.2)
  })
})

describe('stagedStoredShapeFromProject', () => {
  it('rebuilds the staged stored shape, surfacing the hidden feature_uuid', () => {
    const project = {
      baseline: {
        redLine: { featureId: 'rl-1' },
        habitats: [
          {
            featureId: 'f-1',
            ref: 'PR-1',
            properties: { feature_uuid: 'uuid-1' }
          }
        ],
        verticalAreas: [
          {
            featureId: 'f-2',
            ref: 'VAH-1',
            properties: { feature_uuid: 'uuid-2' }
          }
        ],
        trees: [{ featureId: 'f-3', ref: 'T-1', properties: {} }]
      },
      postIntervention: {
        habitats: [{ featureId: 'f-4', ref: 'PR-1' }]
      }
    }

    const shape = stagedStoredShapeFromProject(project)

    expect(shape.baseline[HABITAT_TYPES.AREAS]).toEqual([
      { featureId: 'f-1', ref: 'PR-1', featureUuid: 'uuid-1' }
    ])
    expect(shape.baseline[HABITAT_TYPES.VERTICAL_AREAS]).toEqual([
      { featureId: 'f-2', ref: 'VAH-1', featureUuid: 'uuid-2' }
    ])
    // Pre-uuid stored rows fall back to a null uuid, i.e. ref keying.
    expect(shape.baseline[HABITAT_TYPES.TREES]).toEqual([
      { featureId: 'f-3', ref: 'T-1', featureUuid: null }
    ])
    // The PI side keys on the stored ref, which IS the PI Ref.
    expect(shape.postIntervention[HABITAT_TYPES.AREAS]).toEqual([
      { featureId: 'f-4', piRef: 'PR-1' }
    ])
    expect(shape.redline).toEqual([{ featureId: 'rl-1' }])
  })

  it('returns null when nothing is stored', () => {
    expect(stagedStoredShapeFromProject(undefined)).toBeNull()
    expect(stagedStoredShapeFromProject(null)).toBeNull()
  })

  it('falls back to the post-intervention red line id when the baseline has none', () => {
    const shape = stagedStoredShapeFromProject({
      postIntervention: { redLine: { featureId: 'rl-2' } }
    })

    expect(shape.redline).toEqual([{ featureId: 'rl-2' }])
  })
})
