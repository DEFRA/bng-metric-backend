import { describe, expect, it } from 'vitest'

import {
  assignStagedFeatureIds,
  buildStagedFeatureIdByRef,
  stagedLookupKey
} from './staged-feature-ids.js'
import { HABITAT_TYPES, STAGE } from './staged-layer-names.js'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A staged read with one baseline parcel, one post-intervention parcel derived
 * from it, and a red line.
 */
function makeStaged(overrides = {}) {
  return {
    staged: true,
    redline: [{ ref: null }],
    baseline: {
      [HABITAT_TYPES.AREAS]: [{ ref: 'PR-1' }, { ref: 'PR-2' }]
    },
    postIntervention: {
      [HABITAT_TYPES.AREAS]: [
        { piRef: 'PR-1', parentRef: 'PR-1' },
        { piRef: 'PI-POND', parentRef: null }
      ]
    },
    ...overrides
  }
}

describe('assignStagedFeatureIds without anything stored', () => {
  it('mints a fresh UUID for every feature', () => {
    const result = assignStagedFeatureIds(makeStaged())

    const ids = [
      ...result.redline,
      ...result.baseline[HABITAT_TYPES.AREAS],
      ...result.postIntervention[HABITAT_TYPES.AREAS]
    ].map((feature) => feature.featureId)

    expect(ids).toHaveLength(5)
    expect(new Set(ids).size).toBe(5)
    for (const id of ids) {
      expect(id).toMatch(UUID_PATTERN)
    }
  })

  it('leaves the input untouched', () => {
    const staged = makeStaged()
    assignStagedFeatureIds(staged)

    expect(staged.baseline[HABITAT_TYPES.AREAS][0].featureId).toBeUndefined()
  })
})

describe('assignStagedFeatureIds against a stored document', () => {
  it('carries every id forward when the file is re-uploaded unchanged', () => {
    const stored = assignStagedFeatureIds(makeStaged())
    const again = assignStagedFeatureIds(
      makeStaged(),
      buildStagedFeatureIdByRef(stored)
    )

    expect(again.redline[0].featureId).toBe(stored.redline[0].featureId)
    expect(again.baseline[HABITAT_TYPES.AREAS].map((f) => f.featureId)).toEqual(
      stored.baseline[HABITAT_TYPES.AREAS].map((f) => f.featureId)
    )
    expect(
      again.postIntervention[HABITAT_TYPES.AREAS].map((f) => f.featureId)
    ).toEqual(
      stored.postIntervention[HABITAT_TYPES.AREAS].map((f) => f.featureId)
    )
  })

  it('keeps a baseline parcel and its retained post-intervention twin apart', () => {
    // The fixture's retained parcel has PI Ref "PR-1" against a baseline Parcel
    // Ref of "PR-1". They are two features and must not share an id.
    const stored = assignStagedFeatureIds(makeStaged())

    expect(stored.baseline[HABITAT_TYPES.AREAS][0].featureId).not.toBe(
      stored.postIntervention[HABITAT_TYPES.AREAS][0].featureId
    )
  })

  it('mints a fresh id when the PI Ref changes', () => {
    const stored = assignStagedFeatureIds(makeStaged())
    const renamed = makeStaged()
    renamed.postIntervention[HABITAT_TYPES.AREAS][0].piRef = 'PR-1-renamed'

    const again = assignStagedFeatureIds(
      renamed,
      buildStagedFeatureIdByRef(stored)
    )

    expect(again.postIntervention[HABITAT_TYPES.AREAS][0].featureId).not.toBe(
      stored.postIntervention[HABITAT_TYPES.AREAS][0].featureId
    )
  })

  it('refuses to match a ref that is repeated in the incoming file', () => {
    const stored = assignStagedFeatureIds(makeStaged())
    const duplicated = makeStaged()
    duplicated.baseline[HABITAT_TYPES.AREAS][1].ref = 'PR-1'

    const again = assignStagedFeatureIds(
      duplicated,
      buildStagedFeatureIdByRef(stored)
    )
    const ids = again.baseline[HABITAT_TYPES.AREAS].map((f) => f.featureId)

    expect(ids).not.toContain(stored.baseline[HABITAT_TYPES.AREAS][0].featureId)
    expect(new Set(ids).size).toBe(2)
  })

  it('refuses to match a ref that is repeated in the stored document', () => {
    const stored = assignStagedFeatureIds(makeStaged())
    stored.baseline[HABITAT_TYPES.AREAS][1].ref = 'PR-1'

    const lookup = buildStagedFeatureIdByRef(stored)

    const baselineAreaKeys = [...lookup.keys()].filter((key) =>
      key.startsWith(stagedLookupKey(STAGE.BASELINE, HABITAT_TYPES.AREAS, ''))
    )
    expect(baselineAreaKeys).toEqual([])
  })

  it('keeps a baseline feature keyed by feature_uuid when its ref is renamed', () => {
    // Refs are cosmetic since the uuid columns landed: renaming a parcel must
    // not re-key it. The uuid, not the ref, is the baseline natural key.
    const withUuid = () =>
      makeStaged({
        baseline: {
          [HABITAT_TYPES.AREAS]: [
            { ref: 'PR-1', featureUuid: '26002853-cb9b-40e9-9460-3c8dbd3bd928' }
          ]
        },
        postIntervention: { [HABITAT_TYPES.AREAS]: [] }
      })
    const stored = assignStagedFeatureIds(withUuid())
    const renamed = withUuid()
    renamed.baseline[HABITAT_TYPES.AREAS][0].ref = 'PR-1-renamed'

    const again = assignStagedFeatureIds(
      renamed,
      buildStagedFeatureIdByRef(stored)
    )

    expect(again.baseline[HABITAT_TYPES.AREAS][0].featureId).toBe(
      stored.baseline[HABITAT_TYPES.AREAS][0].featureId
    )
  })

  it('never cross-matches a uuid-keyed store against a ref-only file', () => {
    // A file that lost its uuid columns (edited outside the template) matches
    // nothing — conservative fresh ids, never a wrong carry-forward.
    const stored = assignStagedFeatureIds(
      makeStaged({
        baseline: {
          [HABITAT_TYPES.AREAS]: [
            { ref: 'PR-1', featureUuid: '26002853-cb9b-40e9-9460-3c8dbd3bd928' }
          ]
        },
        postIntervention: { [HABITAT_TYPES.AREAS]: [] }
      })
    )
    const refOnly = makeStaged({
      baseline: { [HABITAT_TYPES.AREAS]: [{ ref: 'PR-1' }] },
      postIntervention: { [HABITAT_TYPES.AREAS]: [] }
    })

    const again = assignStagedFeatureIds(
      refOnly,
      buildStagedFeatureIdByRef(stored)
    )

    expect(again.baseline[HABITAT_TYPES.AREAS][0].featureId).not.toBe(
      stored.baseline[HABITAT_TYPES.AREAS][0].featureId
    )
  })

  it('falls back to the ref for pre-uuid baseline files on both sides', () => {
    // makeStaged carries no featureUuid at all, so this whole block runs on the
    // ref fallback — this test just names that fact explicitly.
    const stored = assignStagedFeatureIds(makeStaged())
    const again = assignStagedFeatureIds(
      makeStaged(),
      buildStagedFeatureIdByRef(stored)
    )

    expect(again.baseline[HABITAT_TYPES.AREAS][0].featureId).toBe(
      stored.baseline[HABITAT_TYPES.AREAS][0].featureId
    )
  })

  it('mints a fresh id for a feature with a blank ref', () => {
    const stored = assignStagedFeatureIds(
      makeStaged({
        baseline: { [HABITAT_TYPES.AREAS]: [{ ref: '  ' }] },
        postIntervention: { [HABITAT_TYPES.AREAS]: [] }
      })
    )
    const again = assignStagedFeatureIds(
      makeStaged({
        baseline: { [HABITAT_TYPES.AREAS]: [{ ref: '  ' }] },
        postIntervention: { [HABITAT_TYPES.AREAS]: [] }
      }),
      buildStagedFeatureIdByRef(stored)
    )

    expect(again.baseline[HABITAT_TYPES.AREAS][0].featureId).not.toBe(
      stored.baseline[HABITAT_TYPES.AREAS][0].featureId
    )
  })

  it('only carries the first red line forward', () => {
    const stored = assignStagedFeatureIds(
      makeStaged({ redline: [{ ref: null }, { ref: null }] })
    )
    const again = assignStagedFeatureIds(
      makeStaged({ redline: [{ ref: null }, { ref: null }] }),
      buildStagedFeatureIdByRef(stored)
    )

    expect(again.redline[0].featureId).toBe(stored.redline[0].featureId)
    expect(again.redline[1].featureId).not.toBe(stored.redline[1].featureId)
  })
})

describe('buildStagedFeatureIdByRef', () => {
  it('returns an empty map when nothing is stored', () => {
    expect(buildStagedFeatureIdByRef(undefined).size).toBe(0)
  })

  it('skips features that have no featureId yet', () => {
    const lookup = buildStagedFeatureIdByRef({
      baseline: { [HABITAT_TYPES.AREAS]: [{ ref: 'PR-1' }] }
    })

    expect(lookup.size).toBe(0)
  })
})
