import { describe, expect, it } from 'vitest'

import {
  HABITAT_TYPES,
  STAGE,
  groupStagedTables,
  isStagedGeoPackage,
  resolveStagedLayer
} from './staged-layer-names.js'

describe('resolveStagedLayer', () => {
  it.each([
    ['Habitats Baseline', STAGE.BASELINE, HABITAT_TYPES.AREAS],
    [
      'Habitats Post-Intervention',
      STAGE.POST_INTERVENTION,
      HABITAT_TYPES.AREAS
    ],
    [
      'Vertical Area Habitats Baseline',
      STAGE.BASELINE,
      HABITAT_TYPES.VERTICAL_AREAS
    ],
    [
      'Vertical Area Habitats Post-Intervention',
      STAGE.POST_INTERVENTION,
      HABITAT_TYPES.VERTICAL_AREAS
    ],
    ['Hedgerows Baseline', STAGE.BASELINE, HABITAT_TYPES.HEDGEROWS],
    [
      'Watercourses Post-Intervention',
      STAGE.POST_INTERVENTION,
      HABITAT_TYPES.WATERCOURSES
    ],
    ['Trees Baseline', STAGE.BASELINE, HABITAT_TYPES.TREES],
    // the template renamed these two layers; both spellings must resolve, so
    // that files made before and after the rename validate identically
    ['Area Habitats Baseline', STAGE.BASELINE, HABITAT_TYPES.AREAS],
    [
      'Area Habitats Post-Intervention',
      STAGE.POST_INTERVENTION,
      HABITAT_TYPES.AREAS
    ],
    ['Individual Trees Baseline', STAGE.BASELINE, HABITAT_TYPES.TREES],
    [
      'Individual Trees Post-Intervention',
      STAGE.POST_INTERVENTION,
      HABITAT_TYPES.TREES
    ]
  ])('resolves %s', (table, stage, type) => {
    expect(resolveStagedLayer(table)).toEqual({ stage, type })
  })

  it('is case and whitespace insensitive', () => {
    expect(resolveStagedLayer('  HABITATS post-intervention ')).toEqual({
      stage: STAGE.POST_INTERVENTION,
      type: HABITAT_TYPES.AREAS
    })
  })

  it('recognises the red line under its several spellings', () => {
    for (const name of ['Red Line Boundary', 'redline', 'red_line']) {
      expect(resolveStagedLayer(name)).toEqual({ redline: true })
    }
  })

  it('returns null for the NE template’s single-stage tables', () => {
    // these carry Baseline* and Proposed* on one row and are handled by the
    // existing LAYER_ALIASES path, not this one
    expect(resolveStagedLayer('Habitats')).toBeNull()
    expect(resolveStagedLayer('Urban Trees')).toBeNull()
  })

  it('does not confuse the renamed area layer with vertical area habitats', () => {
    expect(resolveStagedLayer('Area Habitats Baseline')).toEqual({
      stage: STAGE.BASELINE,
      type: HABITAT_TYPES.AREAS
    })
    expect(resolveStagedLayer('Vertical Area Habitats Baseline')).toEqual({
      stage: STAGE.BASELINE,
      type: HABITAT_TYPES.VERTICAL_AREAS
    })
  })

  it('returns null rather than throwing for junk', () => {
    expect(resolveStagedLayer('layer_styles')).toBeNull()
    expect(resolveStagedLayer('')).toBeNull()
    expect(resolveStagedLayer(undefined)).toBeNull()
    expect(resolveStagedLayer(42)).toBeNull()
  })

  it('returns null for a stage suffix on an unknown habitat type', () => {
    expect(resolveStagedLayer('Ponds Post-Intervention')).toBeNull()
  })
})

describe('isStagedGeoPackage', () => {
  it('is true only when a post-intervention table is present', () => {
    expect(isStagedGeoPackage(['Habitats Baseline'])).toBe(false)
    expect(
      isStagedGeoPackage(['Habitats Baseline', 'Habitats Post-Intervention'])
    ).toBe(true)
  })

  it('is false for the existing single-stage format', () => {
    expect(
      isStagedGeoPackage(['Habitats', 'Hedgerows', 'Red Line Boundary'])
    ).toBe(false)
  })

  it('handles an empty file', () => {
    expect(isStagedGeoPackage([])).toBe(false)
    expect(isStagedGeoPackage()).toBe(false)
  })
})

describe('groupStagedTables', () => {
  it('buckets by stage and type, and keeps unknowns aside', () => {
    const grouped = groupStagedTables([
      'Red Line Boundary',
      'Habitats Baseline',
      'Habitats Post-Intervention',
      'Watercourses Baseline',
      'Watercourses Post-Intervention',
      'layer_styles'
    ])
    expect(grouped.redline).toEqual(['Red Line Boundary'])
    expect(grouped[STAGE.BASELINE]).toEqual({
      [HABITAT_TYPES.AREAS]: 'Habitats Baseline',
      [HABITAT_TYPES.WATERCOURSES]: 'Watercourses Baseline'
    })
    expect(grouped[STAGE.POST_INTERVENTION]).toEqual({
      [HABITAT_TYPES.AREAS]: 'Habitats Post-Intervention',
      [HABITAT_TYPES.WATERCOURSES]: 'Watercourses Post-Intervention'
    })
    // an unfamiliar table is set aside, never a hard failure
    expect(grouped.ignored).toEqual(['layer_styles'])
  })
})
