// The staged → legacy transformer, proven against the real template export
// rather than synthetic shapes: every mapping claim (ref bridging, SRID
// carriage, featureId preservation, purity) is checked on the same fixture the
// integration suite uploads.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { EPSG_BNG } from '../geopackage-constants.js'
import { readStagedGeoPackage } from './read-staged-geopackage.js'
import { assignStagedFeatureIds } from './staged-feature-ids.js'
import { HABITAT_TYPES } from './staged-layer-names.js'
import { stagedToLegacyLayers } from './staged-to-legacy.js'

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'integration-tests',
  'fixtures',
  'staged-baseline-and-pi.gpkg'
)

const LAYER_KEYS = [
  'redline',
  'areas',
  'verticalAreas',
  'hedgerows',
  'watercourses',
  'trees',
  'iggis',
  'missingLayers'
]

function readFixture() {
  return assignStagedFeatureIds(readStagedGeoPackage(FIXTURE))
}

describe('stagedToLegacyLayers against the real fixture', () => {
  it('produces both stages in the readGeoPackage layer shape', () => {
    const { baseline, postIntervention } = stagedToLegacyLayers(readFixture())

    for (const layers of [baseline, postIntervention]) {
      expect(Object.keys(layers).sort()).toEqual([...LAYER_KEYS].sort())
      expect(layers.iggis).toEqual([])
      expect(layers.missingLayers).toEqual([])
    }
    expect(baseline.areas).toHaveLength(2)
    expect(baseline.verticalAreas).toHaveLength(1)
    expect(baseline.hedgerows).toHaveLength(1)
    expect(baseline.watercourses).toHaveLength(1)
    expect(baseline.trees).toHaveLength(2)
    expect(postIntervention.areas).toHaveLength(3)
    expect(postIntervention.trees).toHaveLength(2)
  })

  it('carries decoded geometry and the file SRID on every feature', () => {
    const { baseline, postIntervention } = stagedToLegacyLayers(readFixture())

    for (const layers of [baseline, postIntervention]) {
      for (const key of ['redline', ...Object.values(HABITAT_TYPES)]) {
        for (const feature of layers[key]) {
          expect(feature.type).toBe('Feature')
          expect(feature.nativeGeometry?.type).toBeTruthy()
          expect(feature.nativeSrid).toBe(EPSG_BNG)
        }
      }
    }
  })

  it('preserves the featureId stamped by assignStagedFeatureIds', () => {
    const staged = readFixture()
    const { baseline, postIntervention } = stagedToLegacyLayers(staged)

    expect(baseline.areas.map((f) => f.featureId)).toEqual(
      staged.baseline[HABITAT_TYPES.AREAS].map((f) => f.featureId)
    )
    expect(postIntervention.trees.map((f) => f.featureId)).toEqual(
      staged.postIntervention[HABITAT_TYPES.TREES].map((f) => f.featureId)
    )
  })

  it('maps the one red line into both stages with the same featureId', () => {
    const { baseline, postIntervention } = stagedToLegacyLayers(readFixture())

    expect(baseline.redline).toHaveLength(1)
    expect(postIntervention.redline).toHaveLength(1)
    expect(baseline.redline[0].featureId).toBe(
      postIntervention.redline[0].featureId
    )
    expect(baseline.redline[0].properties['Site Name']).toBe('Spike site')
  })

  it('bridges PI Ref to the legacy ref columns without touching baseline refs', () => {
    const { baseline, postIntervention } = stagedToLegacyLayers(readFixture())

    // Baseline layers already carry the legacy columns.
    expect(baseline.areas.map((f) => f.properties['Parcel Ref'])).toEqual([
      'PR-1',
      'PR-2'
    ])
    expect(baseline.trees.map((f) => f.properties['Tree Ref'])).toEqual([
      'T-1',
      'T-2'
    ])
    // PI layers gain them from PI Ref — including the Enhanced watercourse,
    // whose OWN ref must survive (no parent-ref rewrite).
    expect(
      postIntervention.areas.map((f) => f.properties['Parcel Ref'])
    ).toEqual(['PR-1', 'PR-2', 'PI-POND'])
    expect(
      postIntervention.hedgerows.map((f) => f.properties['Parcel Ref'])
    ).toEqual(['HR-1a'])
    expect(
      postIntervention.watercourses.map((f) => f.properties['Parcel Ref'])
    ).toEqual(['WC-1'])
    expect(postIntervention.trees.map((f) => f.properties['Tree Ref'])).toEqual(
      ['T-1', 'T-NEW-1']
    )
  })

  it('aliases the staged tree advance/delay spellings to the legacy columns', () => {
    const staged = readFixture()
    const [tree] = staged.postIntervention[HABITAT_TYPES.TREES]
    tree.properties['Habitat Created/Enhanced in advance/years'] = '2'
    tree.properties['Delay in starting habitat creation/enhancement in years'] =
      'N/A'

    const { postIntervention } = stagedToLegacyLayers(staged)

    const [legacyTree] = postIntervention.trees
    expect(legacyTree.properties['Habitat created in advance/years']).toBe('2')
    expect(
      legacyTree.properties['Delay in starting habitat creation/years']
    ).toBe('N/A')
  })

  it('never mutates the staged input and never shares property bags', () => {
    const staged = readFixture()
    const before = JSON.stringify(staged)

    const { baseline, postIntervention } = stagedToLegacyLayers(staged)
    baseline.areas[0].properties['Parcel Ref'] = 'TAMPERED'
    postIntervention.areas[0].properties['Parcel Ref'] = 'TAMPERED'

    expect(JSON.stringify(staged)).toBe(before)
    expect(baseline.areas[0].properties).not.toBe(
      staged.baseline[HABITAT_TYPES.AREAS][0].properties
    )
  })
})
