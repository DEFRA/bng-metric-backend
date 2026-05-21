// Reference data for the Habitat Details page (BMD-315): broad habitats,
// habitat types, conditions, and trading rules. Hand-ported from the digital
// prototype.
//
// Once BMD-426 (PR #35) merges, the same data lives in bng-metric-engine.
// Replace the constants below with thin readers over its CONDITION_SCORES
// and DISTINCTIVENESS_SCORES so we have one source of truth.

import { distinctivenessByHabitatType } from './habitat-distinctiveness.js'

export { distinctivenessScores } from './habitat-distinctiveness.js'

// Each habitat type maps to one of four condition profiles. Splitting the
// table this way keeps the file readable: the per-habitat map only carries the
// profile name, while the actual band/score lists live in one place.
const CONDITION_PATTERNS = {
  fiveBand: [
    { condition: 'Good', score: 3 },
    { condition: 'Fairly Good', score: 2.5 },
    { condition: 'Moderate', score: 2 },
    { condition: 'Fairly Poor', score: 1.5 },
    { condition: 'Poor', score: 1 }
  ],
  naAssessment: [{ condition: 'Condition Assessment N/A', score: 1 }],
  naOther: [{ condition: 'N/A - Other', score: 0 }],
  goodOnly: [{ condition: 'Good', score: 3 }]
}

const conditionPatternByHabitatType = {
  'Coastal lagoons - Coastal lagoons': 'fiveBand',
  'Coastal saltmarsh - Artificial saltmarshes and saline reedbeds': 'fiveBand',
  'Coastal saltmarsh - Saltmarshes and saline reedbeds': 'fiveBand',
  'Cropland - Arable field margins cultivated annually': 'naAssessment',
  'Cropland - Arable field margins game bird mix': 'naAssessment',
  'Cropland - Arable field margins pollen and nectar': 'naAssessment',
  'Cropland - Arable field margins tussocky': 'naAssessment',
  'Cropland - Cereal crops': 'naAssessment',
  'Cropland - Horticulture': 'naAssessment',
  'Cropland - Intensive orchards': 'naAssessment',
  'Cropland - Non-cereal crops': 'naAssessment',
  'Cropland - Temporary grass and clover leys': 'naAssessment',
  'Cropland - Winter stubble': 'naAssessment',
  'Grassland - Bracken': 'naAssessment',
  'Grassland - Floodplain wetland mosaic and CFGM': 'fiveBand',
  'Grassland - Lowland calcareous grassland': 'fiveBand',
  'Grassland - Lowland dry acid grassland': 'fiveBand',
  'Grassland - Lowland meadows': 'fiveBand',
  'Grassland - Modified grassland': 'fiveBand',
  'Grassland - Other lowland acid grassland': 'fiveBand',
  'Grassland - Other neutral grassland': 'fiveBand',
  'Grassland - Tall herb communities (H6430)': 'fiveBand',
  'Grassland - Traditional orchards': 'fiveBand',
  'Grassland - Upland acid grassland': 'fiveBand',
  'Grassland - Upland calcareous grassland': 'fiveBand',
  'Grassland - Upland hay meadows': 'fiveBand',
  'Heathland and shrub - Blackthorn scrub': 'fiveBand',
  'Heathland and shrub - Bramble scrub': 'naAssessment',
  'Heathland and shrub - Dunes with sea buckthorn (H2160)': 'fiveBand',
  'Heathland and shrub - Gorse scrub': 'fiveBand',
  'Heathland and shrub - Hawthorn scrub': 'fiveBand',
  'Heathland and shrub - Hazel scrub': 'fiveBand',
  'Heathland and shrub - Lowland heathland': 'fiveBand',
  'Heathland and shrub - Mixed scrub': 'fiveBand',
  'Heathland and shrub - Mountain heaths and willow scrub': 'fiveBand',
  'Heathland and shrub - Other sea buckthorn scrub': 'naAssessment',
  'Heathland and shrub - Rhododendron scrub': 'naAssessment',
  'Heathland and shrub - Upland heathland': 'fiveBand',
  'Heathland and shrub - Willow scrub': 'fiveBand',
  'Individual trees - Rural tree': 'fiveBand',
  'Individual trees - Urban tree': 'fiveBand',
  'Intertidal hard structures - Artificial features of hard structures':
    'fiveBand',
  'Intertidal hard structures - Artificial hard structures': 'fiveBand',
  'Intertidal sediment - Artificial littoral biogenic reefs': 'fiveBand',
  'Intertidal sediment - Artificial littoral coarse sediment': 'fiveBand',
  'Intertidal sediment - Artificial littoral mixed sediments': 'fiveBand',
  'Intertidal sediment - Artificial littoral mud': 'fiveBand',
  'Intertidal sediment - Artificial littoral muddy sand': 'fiveBand',
  'Intertidal sediment - Artificial littoral sand': 'fiveBand',
  'Intertidal sediment - Artificial littoral seagrass': 'fiveBand',
  'Intertidal sediment - Features of littoral sediment': 'fiveBand',
  'Intertidal sediment - Littoral biogenic reefs - Mussels': 'fiveBand',
  'Intertidal sediment - Littoral biogenic reefs - Sabellaria': 'fiveBand',
  'Intertidal sediment - Littoral coarse sediment': 'fiveBand',
  'Intertidal sediment - Littoral mixed sediments': 'fiveBand',
  'Intertidal sediment - Littoral mud': 'fiveBand',
  'Intertidal sediment - Littoral muddy sand': 'fiveBand',
  'Intertidal sediment - Littoral sand': 'fiveBand',
  'Intertidal sediment - Littoral seagrass': 'fiveBand',
  'Intertidal sediment - Littoral seagrass on peat, clay or chalk': 'fiveBand',
  'Infrastructure (IGGI) - Infrastructure (IGGI)': 'fiveBand',
  'Lakes - Aquifer fed naturally fluctuating water bodies': 'fiveBand',
  'Lakes - High alkalinity lakes': 'fiveBand',
  'Lakes - Low alkalinity lakes': 'fiveBand',
  'Lakes - Marl lakes': 'fiveBand',
  'Lakes - Moderate alkalinity lakes': 'fiveBand',
  'Lakes - Ornamental lake or pond': 'fiveBand',
  'Lakes - Peat lakes': 'fiveBand',
  'Lakes - Ponds (non-priority habitat)': 'fiveBand',
  'Lakes - Ponds (priority habitat)': 'fiveBand',
  'Lakes - Reservoirs': 'fiveBand',
  'Lakes - Temporary lakes ponds and pools (H3170)': 'fiveBand',
  'Rocky shore - Features of littoral rock': 'fiveBand',
  'Rocky shore - Features of littoral rock - on peat, clay or chalk':
    'fiveBand',
  'Rocky shore - High energy littoral rock': 'fiveBand',
  'Rocky shore - High energy littoral rock - on peat, clay or chalk':
    'fiveBand',
  'Rocky shore - Low energy littoral rock': 'fiveBand',
  'Rocky shore - Low energy littoral rock - on peat, clay or chalk': 'fiveBand',
  'Rocky shore - Moderate energy littoral rock': 'fiveBand',
  'Rocky shore - Moderate energy littoral rock - on peat, clay or chalk':
    'fiveBand',
  'Sparsely vegetated land - Calaminarian grasslands': 'fiveBand',
  'Sparsely vegetated land - Coastal sand dunes': 'fiveBand',
  'Sparsely vegetated land - Coastal vegetated shingle': 'fiveBand',
  'Sparsely vegetated land - Inland rock outcrop and scree habitats':
    'fiveBand',
  'Sparsely vegetated land - Limestone pavement': 'fiveBand',
  'Sparsely vegetated land - Maritime cliff and slopes': 'fiveBand',
  'Sparsely vegetated land - Other inland rock and scree': 'fiveBand',
  'Sparsely vegetated land - Ruderal/Ephemeral': 'fiveBand',
  'Sparsely vegetated land - Tall forbs': 'fiveBand',
  'Urban - Actively worked sand pit quarry or open cast mine': 'naAssessment',
  'Urban - Allotments': 'fiveBand',
  'Urban - Artificial unvegetated, unsealed surface': 'naOther',
  'Urban - Bare ground': 'fiveBand',
  'Urban - Biodiverse green roof': 'fiveBand',
  'Urban - Bioswale': 'fiveBand',
  'Urban - Built linear features': 'naOther',
  'Urban - Cemeteries and churchyards': 'fiveBand',
  'Urban - Developed land; sealed surface': 'naOther',
  'Urban - Facade-bound green wall': 'fiveBand',
  'Urban - Ground based green wall': 'fiveBand',
  'Urban - Ground level planters': 'naAssessment',
  'Urban - Intensive green roof': 'fiveBand',
  'Urban - Introduced shrub': 'naAssessment',
  'Urban - Open mosaic habitats on previously developed land': 'fiveBand',
  'Urban - Other green roof': 'naAssessment',
  'Urban - Rain garden': 'fiveBand',
  'Urban - Sustainable drainage system': 'fiveBand',
  'Urban - Unvegetated garden': 'naOther',
  'Urban - Vacant or derelict land': 'fiveBand',
  'Urban - Vegetated garden': 'naAssessment',
  'Watercourse footprint - Watercourse footprint': 'naOther',
  'Wetland - Blanket bog': 'fiveBand',
  'Wetland - Depressions on peat substrates (H7150)': 'fiveBand',
  'Wetland - Fens (upland and lowland)': 'fiveBand',
  'Wetland - Lowland raised bog': 'fiveBand',
  'Wetland - Oceanic valley mire[1] (D2.1)': 'fiveBand',
  'Wetland - Purple moor grass and rush pastures': 'fiveBand',
  'Wetland - Reedbeds': 'fiveBand',
  'Wetland - Transition mires and quaking bogs (H7140)': 'fiveBand',
  'Woodland and forest - Felled': 'goodOnly',
  'Woodland and forest - Lowland beech and yew woodland': 'fiveBand',
  'Woodland and forest - Lowland mixed deciduous woodland': 'fiveBand',
  'Woodland and forest - Native pine woodlands': 'fiveBand',
  'Woodland and forest - Other coniferous woodland': 'fiveBand',
  "Woodland and forest - Other Scot's pine woodland": 'fiveBand',
  'Woodland and forest - Other woodland; broadleaved': 'fiveBand',
  'Woodland and forest - Other woodland; mixed': 'fiveBand',
  'Woodland and forest - Upland birchwoods': 'fiveBand',
  'Woodland and forest - Upland mixed ashwoods': 'fiveBand',
  'Woodland and forest - Upland oakwood': 'fiveBand',
  'Woodland and forest - Wet woodland': 'fiveBand',
  'Woodland and forest - Wood-pasture and parkland': 'fiveBand'
}

// Trading rules per AC10. Lifted from the digital prototype's
// distinctivenesScores[band]["Suggested action"]. Wording is provisional;
// swap the values here when UCD finalises.
const tradingRulesByDistinctiveness = {
  'V.High': 'Same habitat required - bespoke compensation option',
  High: 'Same habitat required =',
  Medium: 'Same broad habitat or a higher distinctiveness habitat required (≥)',
  Low: 'Same distinctiveness or better habitat required ≥',
  'V.Low': 'Compensation Not Required'
}

// Habitat types whose distinctiveness band is one of these are shown in the
// Area Habitats dropdown. High and V.High are excluded per AC5b / AC6b.
const AREA_HABITAT_BANDS = new Set(['V.Low', 'Low', 'Medium'])

// Split a habitat type key like 'Grassland - Lowland meadows' or
// 'Rocky shore - High energy littoral rock - on peat, clay or chalk' into
// { broadHabitat, habitatType } on the first ' - ' only.
function splitHabitatTypeKey(key) {
  const sep = ' - '
  const idx = key.indexOf(sep)
  if (idx < 0) {
    return { broadHabitat: key, habitatType: '' }
  }
  return {
    broadHabitat: key.slice(0, idx),
    habitatType: key.slice(idx + sep.length)
  }
}

/**
 * All (broad habitat, habitat type, distinctiveness) triples for area habitats.
 * Used by the broad-habitats and habitat-types reference endpoints.
 *
 * @param {{ areaOnly?: boolean }} [options]
 * @returns {Array<{ broadHabitat: string, habitatType: string, distinctiveness: string }>}
 */
function getHabitatsByBroad(options = {}) {
  const { areaOnly = false } = options
  const rows = []
  for (const [key, distinctiveness] of Object.entries(
    distinctivenessByHabitatType
  )) {
    if (areaOnly && !AREA_HABITAT_BANDS.has(distinctiveness)) {
      continue
    }
    const { broadHabitat, habitatType } = splitHabitatTypeKey(key)
    rows.push({ broadHabitat, habitatType, distinctiveness })
  }
  return rows
}

/**
 * The distinct list of broad habitats present in the area-habitats journey,
 * sorted alphabetically. Excludes broads with no V.Low/Low/Medium entries.
 *
 * @returns {string[]}
 */
function getAreaBroadHabitats() {
  const broads = new Set()
  for (const row of getHabitatsByBroad({ areaOnly: true })) {
    broads.add(row.broadHabitat)
  }
  return [...broads].sort((a, b) => a.localeCompare(b))
}

/**
 * Habitat types (sorted) within a broad habitat that qualify for the area
 * habitats journey.
 *
 * @param {string} broadHabitat
 * @returns {string[]}
 */
function getAreaHabitatTypes(broadHabitat) {
  const types = []
  for (const row of getHabitatsByBroad({ areaOnly: true })) {
    if (row.broadHabitat === broadHabitat) {
      types.push(row.habitatType)
    }
  }
  return types.sort((a, b) => a.localeCompare(b))
}

/**
 * Condition options for a habitat type, in canonical AC8b order, with
 * "Not Possible" entries removed.
 *
 * @param {string} habitatType
 * @returns {Array<{ condition: string, score: number }>}
 */
function getConditionsForHabitatType(habitatType) {
  const pattern = conditionPatternByHabitatType[habitatType]
  if (!pattern) {
    return []
  }
  return CONDITION_PATTERNS[pattern]
}

export {
  CONDITION_PATTERNS,
  conditionPatternByHabitatType,
  tradingRulesByDistinctiveness,
  getHabitatsByBroad,
  getAreaBroadHabitats,
  getAreaHabitatTypes,
  getConditionsForHabitatType
}
