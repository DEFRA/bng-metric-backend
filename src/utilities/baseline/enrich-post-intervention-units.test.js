import { describe, it, expect, vi } from 'vitest'

import * as bngMetricEngine from 'bng-metric-engine'

import { enrichPostInterventionDocumentWithUnits } from './enrich-post-intervention-units.js'
import * as enrichBaselineUnits from './enrich-baseline-units.js'

const FEAT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

function makeAreaHabitat(overrides = {}) {
  return {
    featureId: FEAT_ID,
    ref: 'P1',
    area: 10000,
    sizeSquareMetres: 10000,
    units: null,
    status: 'Incomplete',
    baseline: {
      type: 'Modified grassland',
      broadType: 'Grassland',
      condition: 'Moderate',
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null,
      strategicSignificance: null,
      retentionCategory: 'Retained'
    },
    proposed: {
      type: 'Lowland meadows',
      broadType: 'Grassland',
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

const VALID_HEDGEROW_TYPE = 'Species-rich native hedgerow with trees'

function makeHedgerow(overrides = {}) {
  return {
    featureId: FEAT_ID,
    ref: 'HW1',
    length: null,
    sizeMetres: 1000,
    units: null,
    status: 'Incomplete',
    baseline: {
      type: VALID_HEDGEROW_TYPE,
      condition: 'Good',
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null
    },
    proposed: {
      type: VALID_HEDGEROW_TYPE,
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

describe('enrichPostInterventionDocumentWithUnits — area habitats', () => {
  it('enriches proposed sub-object and sets top-level units and status', () => {
    const doc = {
      habitats: [makeAreaHabitat()],
      hedgerows: [],
      watercourses: []
    }
    enrichPostInterventionDocumentWithUnits(doc)

    const hab = doc.habitats[0]
    expect(hab.proposed.distinctiveness).toBeTruthy()
    expect(typeof hab.proposed.distinctivenessScore).toBe('number')
    expect(typeof hab.proposed.conditionScore).toBe('number')
    expect(typeof hab.units).toBe('number')
    expect(hab.units).toBeGreaterThan(0)
    expect(hab.status).toBe('Complete')
  })

  it('enriches baseline sub-object with distinctiveness and conditionScore', () => {
    const doc = {
      habitats: [makeAreaHabitat()],
      hedgerows: [],
      watercourses: []
    }
    enrichPostInterventionDocumentWithUnits(doc)

    const baseline = doc.habitats[0].baseline
    expect(baseline.distinctiveness).toBeTruthy()
    expect(typeof baseline.distinctivenessScore).toBe('number')
    expect(typeof baseline.conditionScore).toBe('number')
  })

  it('does NOT write distinctiveness/conditionScore to top-level feature fields', () => {
    const doc = {
      habitats: [makeAreaHabitat()],
      hedgerows: [],
      watercourses: []
    }
    enrichPostInterventionDocumentWithUnits(doc)

    const hab = doc.habitats[0]
    expect(hab).not.toHaveProperty('distinctiveness')
    expect(hab).not.toHaveProperty('distinctivenessScore')
    expect(hab).not.toHaveProperty('conditionScore')
  })

  it('leaves status Incomplete and units null when proposed condition is missing', () => {
    const doc = {
      habitats: [
        makeAreaHabitat({
          proposed: { ...makeAreaHabitat().proposed, condition: null }
        })
      ],
      hedgerows: [],
      watercourses: []
    }
    enrichPostInterventionDocumentWithUnits(doc)

    const hab = doc.habitats[0]
    expect(hab.status).toBe('Incomplete')
    expect(hab.units).toBeNull()
  })

  it('leaves status Incomplete when proposed type is unrecognised', () => {
    const doc = {
      habitats: [
        makeAreaHabitat({
          proposed: {
            ...makeAreaHabitat().proposed,
            type: 'Not a real habitat',
            broadType: 'Unknown'
          }
        })
      ],
      hedgerows: [],
      watercourses: []
    }
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger)

    expect(doc.habitats[0].status).toBe('Incomplete')
    expect(logger.warn).toHaveBeenCalled()
  })

  it('logs a warning when baseline type is unrecognised but still enriches proposed side', () => {
    const doc = {
      habitats: [
        makeAreaHabitat({
          baseline: {
            ...makeAreaHabitat().baseline,
            type: 'Unknown',
            broadType: 'Unknown'
          }
        })
      ],
      hedgerows: [],
      watercourses: []
    }
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger)

    expect(typeof doc.habitats[0].units).toBe('number')
    expect(logger.warn).toHaveBeenCalled()
  })
})

describe('enrichPostInterventionDocumentWithUnits — hedgerows', () => {
  it('enriches proposed sub-object of a hedgerow', () => {
    const doc = { habitats: [], hedgerows: [makeHedgerow()], watercourses: [] }
    enrichPostInterventionDocumentWithUnits(doc)

    const hedge = doc.hedgerows[0]
    expect(hedge.proposed.distinctiveness).toBeTruthy()
    expect(typeof hedge.proposed.distinctivenessScore).toBe('number')
    expect(typeof hedge.proposed.conditionScore).toBe('number')
    expect(typeof hedge.units).toBe('number')
    expect(hedge.status).toBe('Complete')
  })

  it('enriches baseline sub-object of a hedgerow', () => {
    const doc = { habitats: [], hedgerows: [makeHedgerow()], watercourses: [] }
    enrichPostInterventionDocumentWithUnits(doc)

    const baseline = doc.hedgerows[0].baseline
    expect(baseline.distinctiveness).toBeTruthy()
    expect(typeof baseline.distinctivenessScore).toBe('number')
    expect(typeof baseline.conditionScore).toBe('number')
  })

  it('does NOT write top-level distinctiveness to hedgerow feature', () => {
    const doc = { habitats: [], hedgerows: [makeHedgerow()], watercourses: [] }
    enrichPostInterventionDocumentWithUnits(doc)

    expect(doc.hedgerows[0]).not.toHaveProperty('distinctiveness')
  })

  it('sets hedgerow status Incomplete when proposed condition missing', () => {
    const base = makeHedgerow()
    const doc = {
      habitats: [],
      hedgerows: [{ ...base, proposed: { ...base.proposed, condition: null } }],
      watercourses: []
    }
    enrichPostInterventionDocumentWithUnits(doc)

    expect(doc.hedgerows[0].status).toBe('Incomplete')
  })

  it('sets hedgerow status Incomplete when proposed type is unrecognised', () => {
    const base = makeHedgerow()
    const doc = {
      habitats: [],
      hedgerows: [
        {
          ...base,
          proposed: {
            ...base.proposed,
            type: 'Not a real hedgerow'
          }
        }
      ],
      watercourses: []
    }
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger)

    expect(doc.hedgerows[0].status).toBe('Incomplete')
    expect(logger.warn).toHaveBeenCalled()
  })

  it('still enriches baseline sub-object when proposed side is N/A', () => {
    const base = makeHedgerow()
    const doc = {
      habitats: [],
      hedgerows: [
        {
          ...base,
          proposed: {
            ...base.proposed,
            type: 'N/A',
            condition: 'N/A'
          }
        }
      ],
      watercourses: []
    }
    enrichPostInterventionDocumentWithUnits(doc)

    const hedge = doc.hedgerows[0]
    expect(hedge.baseline.distinctiveness).toBeTruthy()
    expect(typeof hedge.baseline.conditionScore).toBe('number')
    expect(hedge.proposed.distinctiveness).toBeNull()
    expect(hedge.units).toBeNull()
  })
})

function makeWatercourse(overrides = {}) {
  return {
    featureId: FEAT_ID,
    ref: 'R1',
    length: null,
    sizeMetres: 1000,
    units: null,
    status: 'Incomplete',
    baseline: {
      type: 'Priority habitat',
      condition: 'Good',
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null,
      riparianEncroachment: '3. Minor/ No Encroachment',
      watercourseEncroachment: '2. Minor',
      strategicSignificance: null
    },
    proposed: {
      type: 'Priority habitat',
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

describe('enrichPostInterventionDocumentWithUnits — watercourses', () => {
  it('enriches proposed and baseline sub-objects with multipliers', () => {
    const doc = {
      habitats: [],
      hedgerows: [],
      watercourses: [makeWatercourse()]
    }
    enrichPostInterventionDocumentWithUnits(doc)

    const wc = doc.watercourses[0]
    expect(wc.proposed.distinctiveness).toBeTruthy()
    expect(wc.proposed.waterEncroachmentMultiplier).toBe(0.8)
    expect(wc.proposed.riparianEncroachmentMultiplier).toBe(0.98)
    expect(wc.baseline.distinctiveness).toBeTruthy()
    expect(wc.baseline.waterEncroachmentMultiplier).toBe(0.8)
    expect(wc.baseline.riparianEncroachmentMultiplier).toBe(0.98)
    expect(typeof wc.units).toBe('number')
    expect(wc.status).toBe('Complete')
  })

  it('enriches baseline sub-object when proposed side is N/A', () => {
    const base = makeWatercourse()
    const doc = {
      habitats: [],
      hedgerows: [],
      watercourses: [
        {
          ...base,
          proposed: {
            ...base.proposed,
            type: 'N/A',
            condition: 'N/A',
            riparianEncroachment: 'N/A',
            watercourseEncroachment: 'N/A'
          }
        }
      ]
    }
    enrichPostInterventionDocumentWithUnits(doc)

    const wc = doc.watercourses[0]
    expect(wc.baseline.distinctiveness).toBeTruthy()
    expect(typeof wc.baseline.waterEncroachmentMultiplier).toBe('number')
    expect(wc.proposed.distinctiveness).toBeNull()
    expect(wc.units).toBeNull()
  })
})

describe('enrichPostInterventionDocumentWithUnits — unit totals', () => {
  it('sets document.units totals after enrichment', () => {
    const doc = {
      habitats: [makeAreaHabitat()],
      hedgerows: [],
      watercourses: []
    }
    enrichPostInterventionDocumentWithUnits(doc)

    expect(doc.units).toEqual(
      expect.objectContaining({
        totalUnits: expect.any(Number),
        habitatsTotal: expect.any(Number),
        hedgerowsTotal: 0,
        watercoursesTotal: 0
      })
    )
    expect(doc.units.habitatsTotal).toBeGreaterThan(0)
  })

  it('handles empty document gracefully', () => {
    const doc = {}
    enrichPostInterventionDocumentWithUnits(doc)

    expect(doc.units).toEqual({
      totalUnits: 0,
      habitatsTotal: 0,
      hedgerowsTotal: 0,
      watercoursesTotal: 0,
      treesTotal: 0,
      treesUrbanTotal: 0,
      treesRuralTotal: 0
    })
  })

  it('re-throws unexpected errors from the area habitat engine', () => {
    const doc = {
      habitats: [makeAreaHabitat()],
      hedgerows: [],
      watercourses: []
    }
    const unexpected = new TypeError('engine unavailable')
    vi.spyOn(
      enrichBaselineUnits,
      'calculateAreaHabitatWithCandidates'
    ).mockImplementationOnce(() => {
      throw unexpected
    })

    expect(() => enrichPostInterventionDocumentWithUnits(doc)).toThrow(
      unexpected
    )
  })

  it('re-throws unexpected errors from the linear feature engine', () => {
    const doc = { habitats: [], hedgerows: [makeHedgerow()], watercourses: [] }
    const unexpected = new TypeError('engine unavailable')
    vi.spyOn(
      bngMetricEngine,
      'calculateHedgerowBaseline'
    ).mockImplementationOnce(() => {
      throw unexpected
    })

    expect(() => enrichPostInterventionDocumentWithUnits(doc)).toThrow(
      unexpected
    )
  })

  it('logs a warning but leaves feature status unchanged when baseline-side hedgerow lookup fails', () => {
    const base = makeHedgerow()
    const doc = {
      habitats: [],
      hedgerows: [
        {
          ...base,
          baseline: { ...base.baseline, type: 'Unrecognised baseline type' }
        }
      ],
      watercourses: []
    }
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger)

    const hedge = doc.hedgerows[0]
    // proposed side should still be enriched and mark the feature Complete
    expect(hedge.status).toBe('Complete')
    expect(typeof hedge.units).toBe('number')
    // baseline side stays unenriched (distinctiveness null)
    expect(hedge.baseline.distinctiveness).toBeNull()
    expect(logger.warn).toHaveBeenCalled()
  })

  it('logs a warning but leaves feature status unchanged when baseline-side area lookup fails', () => {
    const doc = {
      habitats: [
        makeAreaHabitat({
          baseline: {
            ...makeAreaHabitat().baseline,
            type: 'Unrecognised baseline type',
            broadType: 'Unknown'
          }
        })
      ],
      hedgerows: [],
      watercourses: []
    }
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger)

    const hab = doc.habitats[0]
    // proposed side still enriched
    expect(typeof hab.units).toBe('number')
    expect(hab.status).toBe('Complete')
    // baseline sub-object stays unenriched
    expect(hab.baseline.distinctiveness).toBeNull()
    expect(logger.warn).toHaveBeenCalled()
  })

  it('uses "unknown" in the warning message when an area habitat has no featureId', () => {
    const hab = makeAreaHabitat({
      proposed: {
        ...makeAreaHabitat().proposed,
        type: 'Unrecognised proposed type',
        broadType: 'Unknown'
      }
    })
    delete hab.featureId
    const doc = { habitats: [hab], hedgerows: [], watercourses: [] }
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger)

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unknown'))
  })

  it('uses "unknown" in the warning message when a hedgerow has no featureId', () => {
    const base = makeHedgerow()
    const hedge = {
      ...base,
      proposed: { ...base.proposed, type: 'Not a real hedgerow type' }
    }
    delete hedge.featureId
    const doc = { habitats: [], hedgerows: [hedge], watercourses: [] }
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger)

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unknown'))
  })
})

// Per-size reference areas in m²: Small 41, Medium 163.
const SMALL_TREE_SQM = 41
const MEDIUM_TREE_SQM = 163

function makeTree(overrides = {}) {
  return {
    featureId: FEAT_ID,
    ref: 'T1',
    area: MEDIUM_TREE_SQM,
    sizeSquareMetres: MEDIUM_TREE_SQM,
    units: null,
    status: 'Incomplete',
    count: 1,
    baseline: {
      type: 'Urban tree',
      broadType: 'Individual trees',
      condition: 'Good',
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null,
      strategicSignificance: null,
      retentionCategory: 'Retained',
      treeSize: 'Small',
      treeSpecies: 'Oak',
      ruralOrUrban: 'Urban',
      sizeSquareMetres: SMALL_TREE_SQM,
      area: SMALL_TREE_SQM
    },
    proposed: {
      type: 'Urban tree',
      broadType: 'Individual trees',
      condition: 'Good',
      conditionScore: null,
      distinctiveness: null,
      distinctivenessScore: null,
      strategicSignificance: null,
      treeSize: 'Medium',
      treeSpecies: 'Oak',
      ruralOrUrban: 'Urban',
      sizeSquareMetres: MEDIUM_TREE_SQM,
      area: MEDIUM_TREE_SQM,
      advanceYears: 0,
      delayYears: 0
    },
    properties: {},
    ...overrides
  }
}

describe('enrichPostInterventionDocumentWithUnits — individual trees', () => {
  it('enriches both sides using each side’s own area and totals trees by type', () => {
    const doc = {
      habitats: [],
      trees: [makeTree()],
      hedgerows: [],
      watercourses: []
    }
    enrichPostInterventionDocumentWithUnits(doc)

    const tree = doc.trees[0]
    // Proposed side drives top-level units, computed from the proposed area
    // (Medium = 163 m² = 0.0163 ha): 0.0163 × distinctiveness 4 × condition 3.
    expect(tree.proposed.distinctiveness).toBe('Medium')
    expect(tree.proposed.conditionScore).toBe(3)
    expect(tree.units).toBeCloseTo(0.1956, 4)
    expect(tree.status).toBe('Complete')

    // Baseline side enriches from the baseline area (Small = 41 m²): 0.0041 × 4 × 3.
    expect(tree.baseline.distinctiveness).toBe('Medium')
    expect(tree.baseline.conditionScore).toBe(3)

    expect(doc.units.treesTotal).toBeCloseTo(0.1956, 4)
    expect(doc.units.treesUrbanTotal).toBeCloseTo(0.1956, 4)
    expect(doc.units.treesRuralTotal).toBe(0)
  })

  it('leaves units unset and status Incomplete when proposed type is missing', () => {
    const tree = makeTree()
    tree.proposed.type = null
    const doc = { habitats: [], trees: [tree], hedgerows: [], watercourses: [] }
    enrichPostInterventionDocumentWithUnits(doc)

    expect(doc.trees[0].units).toBeNull()
    expect(doc.trees[0].status).toBe('Incomplete')
    expect(doc.units.treesTotal).toBe(0)
  })

  it('labels a tree enrichment failure as "Individual tree", not "Habitat parcel"', () => {
    const tree = makeTree()
    tree.baseline.type = 'Unrecognised baseline type'
    tree.baseline.broadType = 'Unknown'
    const doc = { habitats: [], trees: [tree], hedgerows: [], watercourses: [] }
    const logger = { warn: vi.fn() }
    enrichPostInterventionDocumentWithUnits(doc, logger)

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Individual tree featureId')
    )
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('Habitat parcel')
    )
  })

  it('does not enrich a tree side whose own area is null with the proposed-side area', () => {
    // Unknown baseline tree-size band → treeAreaFields returns area: null. The
    // proposed side still has its Medium (163 m²) area. The baseline side must be
    // skipped, not silently enriched from the proposed area.
    const tree = makeTree()
    tree.baseline.treeSize = 'Unknown size band'
    tree.baseline.sizeSquareMetres = null
    tree.baseline.area = null
    const doc = { habitats: [], trees: [tree], hedgerows: [], watercourses: [] }
    enrichPostInterventionDocumentWithUnits(doc)

    // Proposed side still enriches normally.
    expect(doc.trees[0].proposed.distinctiveness).toBe('Medium')
    expect(typeof doc.trees[0].units).toBe('number')
    // Baseline side stays unenriched because its own area is unknown.
    expect(doc.trees[0].baseline.distinctiveness).toBeNull()
    expect(doc.trees[0].baseline.conditionScore).toBeNull()
    expect(doc.trees[0].baseline.distinctivenessScore).toBeNull()
  })
})
