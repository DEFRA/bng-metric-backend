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
      strategicSignificance: null,
      retentionCategory: 'Retained'
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

export function makeLostHabitat() {
  return makeAreaHabitat({
    baseline: {
      type: null,
      broadType: null,
      condition: null,
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null,
      strategicSignificance: null,
      retentionCategory: 'Lost'
    }
  })
}

export function makeCreatedAreaHabitat() {
  return makeAreaHabitat({
    baseline: {
      type: null,
      broadType: null,
      condition: null,
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null,
      strategicSignificance: null,
      retentionCategory: 'Created'
    }
  })
}

export function makeEnhancedHabitat() {
  return makeAreaHabitat({
    baseline: {
      type: AREA_BASELINE_TYPE,
      broadType: AREA_BASELINE_BROAD,
      condition: 'Moderate',
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null,
      strategicSignificance: null,
      retentionCategory: 'Enhanced'
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
    length: null,
    sizeMetres: 1000,
    units: null,
    status: 'Incomplete',
    baseline: {
      type: HEDGE_TYPE_HIGH,
      retentionCategory: 'Retained',
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
    baseline: {
      type: null,
      retentionCategory: 'Created',
      condition: null,
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null
    }
  })
}

export function makeEnhancedHedgerow() {
  return makeHedgerow({
    baseline: {
      type: HEDGE_TYPE_MEDIUM,
      retentionCategory: 'Enhanced',
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

export function makeWatercourse(overrides = {}) {
  return {
    featureId: FEAT_ID,
    ref: 'R1',
    length: null,
    sizeMetres: 1000,
    units: null,
    status: 'Incomplete',
    baseline: {
      type: WC_TYPE,
      retentionCategory: 'Retained',
      condition: 'Good',
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null,
      riparianEncroachment: '3. Minor/ No Encroachment',
      watercourseEncroachment: '2. Minor',
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
      riparianEncroachment: '3. Minor/ No Encroachment',
      watercourseEncroachment: '2. Minor',
      strategicSignificance: null
    },
    properties: {},
    ...overrides
  }
}

export function makeCreatedWatercourse() {
  return makeWatercourse({
    baseline: {
      type: null,
      retentionCategory: 'Created',
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

export function makeEnhancedWatercourse() {
  return makeWatercourse({
    baseline: {
      type: WC_TYPE,
      retentionCategory: 'Enhanced',
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
