// featureId stability for the staged format, against the real template export.
//
// The unit tests in src/.../staged-feature-ids.test.js cover the matching rules
// on synthetic data. What they cannot prove is the claim the whole thing rests
// on: that the template's own columns — the hidden `feature_uuid` on the
// baseline (with `Parcel Ref` / `Tree Ref` as the pre-uuid fallback), `PI Ref`
// post-intervention — actually come through readStagedGeoPackage as non-blank,
// unambiguous keys for every one of the five habitat types. If they did not,
// every re-upload would silently mint fresh ids and nothing would fail.

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { readStagedGeoPackage } from '../src/validation/geopackage/lineage/read-staged-geopackage.js'
import {
  assignStagedFeatureIds,
  buildStagedFeatureIdByRef
} from '../src/validation/geopackage/lineage/staged-feature-ids.js'
import { HABITAT_TYPES } from '../src/validation/geopackage/lineage/staged-layer-names.js'

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'staged-baseline-and-pi.gpkg'
)

function idsByStageAndType(assigned) {
  const ids = {}
  for (const stage of ['baseline', 'postIntervention']) {
    for (const [type, features] of Object.entries(assigned[stage])) {
      ids[`${stage}:${type}`] = features.map((feature) => feature.featureId)
    }
  }
  return ids
}

describe('featureId carry-forward across a staged re-upload', () => {
  it('keeps every id when the same file is uploaded again', () => {
    const first = assignStagedFeatureIds(readStagedGeoPackage(FIXTURE))
    const second = assignStagedFeatureIds(
      readStagedGeoPackage(FIXTURE),
      buildStagedFeatureIdByRef(first)
    )

    expect(idsByStageAndType(second)).toEqual(idsByStageAndType(first))
    expect(second.redline[0].featureId).toBe(first.redline[0].featureId)
  })

  it('produces a usable key for every feature in the file', () => {
    // The claim being tested: `PI Ref` and `Parcel Ref` / `Tree Ref` are present
    // and unique on every layer, so nothing falls back to a fresh UUID.
    const first = assignStagedFeatureIds(readStagedGeoPackage(FIXTURE))
    const lookup = buildStagedFeatureIdByRef(first)

    const featureCount = Object.values(first.baseline)
      .concat(Object.values(first.postIntervention))
      .reduce((total, features) => total + features.length, 0)

    // +1 for the red line, which is keyed on its own without a ref.
    expect(lookup.size).toBe(featureCount + 1)
  })

  it('covers all five habitat types on both sides', () => {
    const first = assignStagedFeatureIds(readStagedGeoPackage(FIXTURE))

    for (const type of Object.values(HABITAT_TYPES)) {
      for (const feature of first.baseline[type]) {
        expect(feature.featureId, `baseline ${type}`).toBeTruthy()
      }
      for (const feature of first.postIntervention[type]) {
        expect(feature.featureId, `PI ${type}`).toBeTruthy()
      }
    }
  })

  it('keeps a baseline parcel’s id when the surveyor renames its Parcel Ref', () => {
    // Baseline refs are cosmetic since the uuid columns landed: the natural key
    // is the hidden feature_uuid, which survives a rename. This is the
    // fixture-backed proof that the template's uuid column actually comes
    // through readStagedGeoPackage and keys the carry-forward.
    const first = assignStagedFeatureIds(readStagedGeoPackage(FIXTURE))
    const edited = readStagedGeoPackage(FIXTURE)
    const renamed = edited.baseline[HABITAT_TYPES.AREAS].find(
      (feature) => feature.ref === 'PR-1'
    )
    expect(renamed.featureUuid).toBeTruthy()
    renamed.ref = 'PR-1-renamed'

    const second = assignStagedFeatureIds(
      edited,
      buildStagedFeatureIdByRef(first)
    )

    const before = first.baseline[HABITAT_TYPES.AREAS].find(
      (feature) => feature.ref === 'PR-1'
    ).featureId
    const after = second.baseline[HABITAT_TYPES.AREAS].find(
      (feature) => feature.ref === 'PR-1-renamed'
    ).featureId

    expect(after).toBe(before)
  })

  it('falls back to refs for a pre-uuid export, on both sides', () => {
    const stripUuids = (staged) => {
      for (const features of Object.values(staged.baseline)) {
        for (const feature of features) {
          feature.featureUuid = null
        }
      }
      return staged
    }
    const first = assignStagedFeatureIds(
      stripUuids(readStagedGeoPackage(FIXTURE))
    )
    const second = assignStagedFeatureIds(
      stripUuids(readStagedGeoPackage(FIXTURE)),
      buildStagedFeatureIdByRef(first)
    )

    expect(idsByStageAndType(second)).toEqual(idsByStageAndType(first))
  })

  it('mints a fresh id for a parcel whose PI Ref the surveyor changed', () => {
    const first = assignStagedFeatureIds(readStagedGeoPackage(FIXTURE))
    const edited = readStagedGeoPackage(FIXTURE)
    const renamed = edited.postIntervention[HABITAT_TYPES.AREAS].find(
      (feature) => feature.piRef === 'PI-POND'
    )
    renamed.piRef = 'PI-POND-2'

    const second = assignStagedFeatureIds(
      edited,
      buildStagedFeatureIdByRef(first)
    )

    const before = first.postIntervention[HABITAT_TYPES.AREAS].find(
      (feature) => feature.piRef === 'PI-POND'
    ).featureId
    const after = second.postIntervention[HABITAT_TYPES.AREAS].find(
      (feature) => feature.piRef === 'PI-POND-2'
    ).featureId

    expect(after).not.toBe(before)
    // Everything else still carries forward — one edit does not re-key the file.
    expect(
      second.baseline[HABITAT_TYPES.AREAS].map((f) => f.featureId)
    ).toEqual(first.baseline[HABITAT_TYPES.AREAS].map((f) => f.featureId))
  })
})
