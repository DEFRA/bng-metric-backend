// Habitat condition reference data.
//
// The Statutory Biodiversity Metric defines which condition assessment options
// are permitted for each habitat type, and the numeric score per option. The
// raw matrix is ~120 rows × 7 columns in the source spreadsheet, but it
// collapses to four patterns:
//
//   STANDARD          — Good 3 / Fairly Good 2.5 / Moderate 2 / Fairly Poor 1.5
//                       / Poor 1. Used by most habitats that admit a condition
//                       assessment.
//   NA_CONDITION_ONE  — Only "Condition Assessment N/A" is permitted, score 1.
//                       Used by habitats where condition is not meaningfully
//                       assessable (e.g. all Cropland variants, bramble scrub).
//   NA_OTHER_ZERO     — Only "N/A - Other" is permitted, score 0. Used by
//                       sealed-surface and watercourse-footprint habitats.
//   WOODLAND_FELLED   — Only "Good" is permitted, score 3. The Felled woodland
//                       habitat type is a single special case.
//
// Source: digital prototype `metric-values-habitat-condition.js`, condensed
// from the verbatim per-habitat-type table.
//
// `getConditionScore` returns the numeric score for a (habitatType, condition)
// pair, or `null` if the combination is not permitted or unknown. Callers
// treat `null` as "incomplete / invalid for unit calculation".

const STANDARD = {
  Good: 3,
  'Fairly Good': 2.5,
  Moderate: 2,
  'Fairly Poor': 1.5,
  Poor: 1
}
const NA_CONDITION_ONE = { 'Condition Assessment N/A': 1 }
const NA_OTHER_ZERO = { 'N/A - Other': 0 }
const WOODLAND_FELLED = { Good: 3 }

const naConditionOneTypes = [
  'Cropland - Arable field margins cultivated annually',
  'Cropland - Arable field margins game bird mix',
  'Cropland - Arable field margins pollen and nectar',
  'Cropland - Arable field margins tussocky',
  'Cropland - Cereal crops',
  'Cropland - Winter stubble',
  'Cropland - Horticulture',
  'Cropland - Intensive orchards',
  'Cropland - Non-cereal crops',
  'Cropland - Temporary grass and clover leys',
  'Grassland - Bracken',
  'Heathland and shrub - Bramble scrub',
  'Heathland and shrub - Rhododendron scrub',
  'Heathland and shrub - Other sea buckthorn scrub',
  'Urban - Other green roof',
  'Urban - Ground level planters',
  'Urban - Introduced shrub',
  'Urban - Actively worked sand pit quarry or open cast mine',
  'Urban - Vegetated garden'
]

const naOtherZeroTypes = [
  'Urban - Artificial unvegetated, unsealed surface',
  'Urban - Built linear features',
  'Urban - Developed land; sealed surface',
  'Urban - Unvegetated garden',
  'Watercourse footprint - Watercourse footprint'
]

const standardTypes = [
  'Grassland - Traditional orchards',
  'Grassland - Floodplain wetland mosaic and CFGM',
  'Grassland - Lowland calcareous grassland',
  'Grassland - Lowland dry acid grassland',
  'Grassland - Lowland meadows',
  'Grassland - Modified grassland',
  'Grassland - Other lowland acid grassland',
  'Grassland - Other neutral grassland',
  'Grassland - Tall herb communities (H6430)',
  'Grassland - Upland acid grassland',
  'Grassland - Upland calcareous grassland',
  'Grassland - Upland hay meadows',
  'Heathland and shrub - Blackthorn scrub',
  'Heathland and shrub - Gorse scrub',
  'Heathland and shrub - Hawthorn scrub',
  'Heathland and shrub - Hazel scrub',
  'Heathland and shrub - Lowland heathland',
  'Heathland and shrub - Mixed scrub',
  'Heathland and shrub - Mountain heaths and willow scrub',
  'Heathland and shrub - Dunes with sea buckthorn (H2160)',
  'Heathland and shrub - Willow scrub',
  'Heathland and shrub - Upland heathland',
  'Lakes - Aquifer fed naturally fluctuating water bodies',
  'Lakes - High alkalinity lakes',
  'Lakes - Low alkalinity lakes',
  'Lakes - Marl lakes',
  'Lakes - Moderate alkalinity lakes',
  'Lakes - Peat lakes',
  'Lakes - Ponds (priority habitat)',
  'Lakes - Ponds (non-priority habitat)',
  'Lakes - Reservoirs',
  'Lakes - Temporary lakes ponds and pools (H3170)',
  'Lakes - Ornamental lake or pond',
  'Sparsely vegetated land - Calaminarian grasslands',
  'Sparsely vegetated land - Coastal sand dunes',
  'Sparsely vegetated land - Coastal vegetated shingle',
  'Sparsely vegetated land - Ruderal/Ephemeral',
  'Sparsely vegetated land - Tall forbs',
  'Sparsely vegetated land - Inland rock outcrop and scree habitats',
  'Sparsely vegetated land - Limestone pavement',
  'Sparsely vegetated land - Maritime cliff and slopes',
  'Sparsely vegetated land - Other inland rock and scree',
  'Urban - Allotments',
  'Urban - Bioswale',
  'Urban - Intensive green roof',
  'Urban - Cemeteries and churchyards',
  'Urban - Facade-bound green wall',
  'Urban - Ground based green wall',
  'Urban - Biodiverse green roof',
  'Urban - Open mosaic habitats on previously developed land',
  'Urban - Rain garden',
  'Urban - Sustainable drainage system',
  'Urban - Vacant or derelict land',
  'Urban - Bare ground',
  'Individual trees - Urban tree',
  'Individual trees - Rural tree',
  'Wetland - Blanket bog',
  'Wetland - Depressions on peat substrates (H7150)',
  'Wetland - Fens (upland and lowland)',
  'Wetland - Lowland raised bog',
  'Wetland - Oceanic valley mire[1] (D2.1)',
  'Wetland - Purple moor grass and rush pastures',
  'Wetland - Reedbeds',
  'Wetland - Transition mires and quaking bogs (H7140)',
  'Woodland and forest - Lowland beech and yew woodland',
  'Woodland and forest - Lowland mixed deciduous woodland',
  'Woodland and forest - Native pine woodlands',
  'Woodland and forest - Other coniferous woodland',
  "Woodland and forest - Other Scot's pine woodland",
  'Woodland and forest - Other woodland; broadleaved',
  'Woodland and forest - Other woodland; mixed',
  'Woodland and forest - Upland birchwoods',
  'Woodland and forest - Upland mixed ashwoods',
  'Woodland and forest - Upland oakwood',
  'Woodland and forest - Wet woodland',
  'Woodland and forest - Wood-pasture and parkland',
  'Coastal lagoons - Coastal lagoons',
  'Rocky shore - High energy littoral rock',
  'Rocky shore - High energy littoral rock - on peat, clay or chalk',
  'Rocky shore - Moderate energy littoral rock',
  'Rocky shore - Moderate energy littoral rock - on peat, clay or chalk',
  'Rocky shore - Low energy littoral rock',
  'Rocky shore - Low energy littoral rock - on peat, clay or chalk',
  'Rocky shore - Features of littoral rock',
  'Rocky shore - Features of littoral rock - on peat, clay or chalk',
  'Coastal saltmarsh - Saltmarshes and saline reedbeds',
  'Coastal saltmarsh - Artificial saltmarshes and saline reedbeds',
  'Intertidal sediment - Littoral coarse sediment',
  'Intertidal sediment - Littoral mud',
  'Intertidal sediment - Littoral mixed sediments',
  'Intertidal sediment - Littoral seagrass',
  'Intertidal sediment - Littoral seagrass on peat, clay or chalk',
  'Intertidal sediment - Littoral biogenic reefs - Mussels',
  'Intertidal sediment - Littoral biogenic reefs - Sabellaria',
  'Intertidal sediment - Features of littoral sediment',
  'Intertidal sediment - Artificial littoral coarse sediment',
  'Intertidal sediment - Artificial littoral mud',
  'Intertidal sediment - Artificial littoral sand',
  'Intertidal sediment - Artificial littoral muddy sand',
  'Intertidal sediment - Artificial littoral mixed sediments',
  'Intertidal sediment - Artificial littoral seagrass',
  'Intertidal sediment - Artificial littoral biogenic reefs',
  'Intertidal sediment - Littoral sand',
  'Intertidal sediment - Littoral muddy sand',
  'Intertidal hard structures - Artificial hard structures',
  'Intertidal hard structures - Artificial features of hard structures',
  'Intertidal hard structures - Artificial hard structures with integrated greening of grey infrastructure (IGGI)'
]

const conditionsByHabitatType = {}
for (const t of standardTypes) {
  conditionsByHabitatType[t] = STANDARD
}
for (const t of naConditionOneTypes) {
  conditionsByHabitatType[t] = NA_CONDITION_ONE
}
for (const t of naOtherZeroTypes) {
  conditionsByHabitatType[t] = NA_OTHER_ZERO
}
conditionsByHabitatType['Woodland and forest - Felled'] = WOODLAND_FELLED

/**
 * Look up the numeric condition score for a (habitatType, condition) pair.
 * Returns `null` when the combination is not permitted or unknown — callers
 * treat that as "incomplete", scoring zero habitat units.
 *
 * @param {string|null|undefined} habitatType
 * @param {string|null|undefined} condition
 * @returns {number|null}
 */
function getConditionScore(habitatType, condition) {
  if (!habitatType || !condition) {
    return null
  }
  const row = conditionsByHabitatType[habitatType]
  if (!row) {
    return null
  }
  const score = row[condition]
  return typeof score === 'number' ? score : null
}

export { conditionsByHabitatType, getConditionScore }
