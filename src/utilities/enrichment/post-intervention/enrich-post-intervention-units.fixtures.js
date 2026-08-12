export const FEAT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

// ---------------------------------------------------------------------------
// Area habitat fixtures
// ---------------------------------------------------------------------------

export const AREA_BASELINE_TYPE = 'Modified grassland'
export const AREA_BASELINE_BROAD = 'Grassland'
export const AREA_PROPOSED_TYPE = 'Lowland meadows'
export const AREA_PROPOSED_BROAD = 'Grassland'

export function makeAreaHabitat(overrides = {}) {
  return {
    featureId: FEAT_ID,
    ref: 'P1',
    retentionCategory: 'Retained',
    area: 10000,
    sizeSquareMetres: 10000,
    units: null,
    status: 'Incomplete',
    baseline: {
      type: AREA_BASELINE_TYPE,
      broadType: AREA_BASELINE_BROAD,
      condition: 'Moderate',
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null,
      strategicSignificance: null
    },
    proposed: {
      type: AREA_PROPOSED_TYPE,
      broadType: AREA_PROPOSED_BROAD,
      condition: 'Good',
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null,
      strategicSignificance: null,
      advanceYears: 0,
      delayYears: 0
    },
    properties: {},
    ...overrides
  }
}

/** GPKG Lost area habitats are persisted with top-level retentionCategory Created. */
export function makeLostHabitat() {
  return makeAreaHabitat({
    retentionCategory: 'Created',
    baseline: {
      type: null,
      broadType: null,
      condition: null,
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null,
      strategicSignificance: null
    }
  })
}

/** Same persisted shape as GPKG Lost habitats (see makeLostHabitat). */
export function makeCreatedAreaHabitat() {
  return makeLostHabitat()
}

export function makeEnhancedHabitat() {
  return makeAreaHabitat({
    retentionCategory: 'Enhanced',
    baseline: {
      type: AREA_BASELINE_TYPE,
      broadType: AREA_BASELINE_BROAD,
      condition: 'Moderate',
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null,
      strategicSignificance: null
    }
  })
}

// ---------------------------------------------------------------------------
// Hedgerow fixtures
// ---------------------------------------------------------------------------

export const HEDGE_TYPE_HIGH = 'Species-rich native hedgerow with trees'
export const HEDGE_TYPE_MEDIUM = 'Species-rich native hedgerow'

export function makeHedgerow(overrides = {}) {
  return {
    featureId: FEAT_ID,
    ref: 'HW1',
    retentionCategory: 'Retained',
    length: null,
    sizeMetres: 1000,
    units: null,
    status: 'Incomplete',
    baseline: {
      type: HEDGE_TYPE_HIGH,
      condition: 'Good',
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null
    },
    proposed: {
      type: HEDGE_TYPE_HIGH,
      condition: 'Good',
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null,
      advanceYears: 0,
      delayYears: 0
    },
    properties: {},
    ...overrides
  }
}

export function makeCreatedHedgerow() {
  return makeHedgerow({
    retentionCategory: 'Created',
    baseline: {
      type: null,
      condition: null,
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null
    }
  })
}

/** Legacy stored hedgerow imported before Lost-linear exclusion. */
export function makeLostHedgerow() {
  return makeHedgerow({
    retentionCategory: undefined,
    baseline: {
      type: HEDGE_TYPE_HIGH,
      retentionCategory: 'Lost',
      condition: 'Good',
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null
    }
  })
}

export function makeEnhancedHedgerow() {
  return makeHedgerow({
    retentionCategory: 'Enhanced',
    baseline: {
      type: HEDGE_TYPE_MEDIUM,
      condition: 'Moderate',
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null
    },
    proposed: {
      type: HEDGE_TYPE_HIGH,
      condition: 'Good',
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null,
      advanceYears: 0,
      delayYears: 0
    }
  })
}

// ---------------------------------------------------------------------------
// Watercourse fixtures
// ---------------------------------------------------------------------------

export const WC_TYPE = 'Priority habitat'
const WC_RIPARIAN_ENCROACHMENT_MINOR = '3. Minor/ No Encroachment'
const WC_WATERCOURSE_ENCROACHMENT_MINOR = '2. Minor'

export function makeWatercourse(overrides = {}) {
  return {
    featureId: FEAT_ID,
    ref: 'R1',
    retentionCategory: 'Retained',
    length: null,
    sizeMetres: 1000,
    units: null,
    status: 'Incomplete',
    baseline: {
      type: WC_TYPE,
      condition: 'Good',
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null,
      riparianEncroachment: WC_RIPARIAN_ENCROACHMENT_MINOR,
      watercourseEncroachment: WC_WATERCOURSE_ENCROACHMENT_MINOR,
      strategicSignificance: null
    },
    proposed: {
      type: WC_TYPE,
      condition: 'Good',
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null,
      advanceYears: 0,
      delayYears: 0,
      riparianEncroachment: WC_RIPARIAN_ENCROACHMENT_MINOR,
      watercourseEncroachment: WC_WATERCOURSE_ENCROACHMENT_MINOR,
      strategicSignificance: null
    },
    properties: {},
    ...overrides
  }
}

export function makeCreatedWatercourse() {
  return makeWatercourse({
    retentionCategory: 'Created',
    baseline: {
      type: null,
      condition: null,
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null,
      riparianEncroachment: null,
      watercourseEncroachment: null,
      strategicSignificance: null
    },
    proposed: {
      type: WC_TYPE,
      condition: 'Moderate',
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null,
      advanceYears: 0,
      delayYears: 0,
      riparianEncroachment: 'No Encroachment/No Encroachment',
      watercourseEncroachment: 'No Encroachment',
      strategicSignificance: null
    }
  })
}

/** Legacy stored watercourse imported before Lost-linear exclusion. */
export function makeLostWatercourse() {
  return makeWatercourse({
    retentionCategory: undefined,
    baseline: {
      type: WC_TYPE,
      retentionCategory: 'Lost',
      condition: 'Good',
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null,
      riparianEncroachment: WC_RIPARIAN_ENCROACHMENT_MINOR,
      watercourseEncroachment: WC_WATERCOURSE_ENCROACHMENT_MINOR,
      strategicSignificance: null
    }
  })
}

export function makeEnhancedWatercourse() {
  return makeWatercourse({
    retentionCategory: 'Enhanced',
    baseline: {
      type: WC_TYPE,
      condition: 'Moderate',
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null,
      riparianEncroachment: null,
      watercourseEncroachment: null,
      strategicSignificance: null
    },
    proposed: {
      type: WC_TYPE,
      condition: 'Good',
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null,
      advanceYears: 0,
      delayYears: 0,
      riparianEncroachment: null,
      watercourseEncroachment: null,
      strategicSignificance: null
    }
  })
}

export function makeDoc(overrides = {}) {
  return { habitats: [], hedgerows: [], watercourses: [], ...overrides }
}
