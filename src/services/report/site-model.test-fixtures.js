/**
 * A small site model, shaped exactly as `site-data.js` produces one.
 *
 * Two parcels splitting the site down the middle, a hedgerow along its northern
 * edge, a watercourse across the middle, a tree and a red line around the lot,
 * in real EPSG:27700 metres. Small enough to read, complete enough that every
 * drawing and tagging path in the document runs.
 *
 * Every coordinate is derived from the four site corners rather than typed out,
 * so the relationships are visible: A2 starts where A1 ends because both are
 * expressed against the same midpoint, not because two literals happen to
 * match.
 */

const SITE_WEST = 412_000
const SITE_EAST = 412_400
const SITE_SOUTH = 287_000
const SITE_NORTH = 287_300
const SITE_MID_EASTING = (SITE_WEST + SITE_EAST) / 2
const SITE_MID_NORTHING = (SITE_SOUTH + SITE_NORTH) / 2

/** A closed rectangular ring, as a MultiPolygon. */
function parcel(minX, minY, maxX, maxY) {
  return {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [minX, minY],
          [maxX, minY],
          [maxX, maxY],
          [minX, maxY],
          [minX, minY]
        ]
      ]
    ]
  }
}

/** A single east-west line at one northing, as a MultiLineString. */
function eastWestLine(northing) {
  return {
    type: 'MultiLineString',
    coordinates: [
      [
        [SITE_WEST, northing],
        [SITE_EAST, northing]
      ]
    ]
  }
}

const RED_LINE = parcel(SITE_WEST, SITE_SOUTH, SITE_EAST, SITE_NORTH)

const SITE_AREA_SQ_M = (SITE_EAST - SITE_WEST) * (SITE_NORTH - SITE_SOUTH)
const PARCEL_AREA_SQ_M = SITE_AREA_SQ_M / 2
const LINEAR_LENGTH_M = SITE_EAST - SITE_WEST

function properties({
  ref,
  type,
  condition,
  broadType = null,
  distinctiveness = null,
  strategicSignificance = null,
  retentionCategory = null,
  units = null,
  sizeSquareMetres = null,
  sizeMetres = null,
  conditionScore = null,
  distinctivenessScore = null,
  spatialRiskCategory = null,
  status = null,
  surveyDate = null,
  surveyDetails = null,
  comment = null,
  difficulty = null,
  difficultyMultiplier = null,
  standardTimeToTargetCondition = null,
  finalTimeToTargetCondition = null,
  advanceOrDelay = null
}) {
  return {
    ref,
    type,
    condition,
    broadType,
    distinctiveness,
    strategicSignificance,
    retentionCategory,
    units,
    sizeSquareMetres,
    sizeMetres,
    conditionScore,
    distinctivenessScore,
    spatialRiskCategory,
    status,
    surveyDate,
    surveyDetails,
    comment,
    difficulty,
    difficultyMultiplier,
    standardTimeToTargetCondition,
    finalTimeToTargetCondition,
    advanceOrDelay
  }
}

/**
 * Long enough to wrap in the card's value column, which is the point: the two
 * free-text fields are the only ones whose height cannot be counted, so a
 * fixture that kept them to a few words would leave the measuring path untested
 * in every end-to-end render.
 */
const SURVEY_DETAILS =
  'UKHab Level 3 survey walked on foot in dry conditions, with quadrats at ' +
  'twenty-metre intervals along the western boundary and a full species list ' +
  'recorded for each.'

const PARCEL_COMMENT =
  'Grazed by cattle until the previous season and now rank. Adjoins the ' +
  'watercourse along its northern edge, so the buffer strip is excluded from ' +
  'the measured area.'

function habitats() {
  return [
    {
      properties: properties({
        ref: 'A1',
        type: 'Modified grassland',
        broadType: 'Grassland',
        condition: 'Poor',
        distinctiveness: 'Low',
        strategicSignificance: 'Location ecologically desirable',
        retentionCategory: 'Retained',
        units: 3.6,
        sizeSquareMetres: PARCEL_AREA_SQ_M,
        // The scores behind the two bands, and the fields the GeoPackage
        // records against a parcel rather than the engine calculating them.
        conditionScore: 2,
        distinctivenessScore: 2,
        spatialRiskCategory: 'Within LPA',
        status: 'Complete',
        surveyDate: '2025-06-14',
        surveyDetails: SURVEY_DETAILS,
        comment: PARCEL_COMMENT
      }),
      geometry: parcel(SITE_WEST, SITE_SOUTH, SITE_MID_EASTING, SITE_NORTH)
    },
    {
      // Deliberately uncalculated: no distinctiveness, no units. A project that
      // has not been through the engine still has to produce a report, and the
      // card layout must shorten rather than print blanks.
      properties: properties({
        ref: 'A2',
        type: 'Cereal crops',
        broadType: 'Cropland',
        condition: 'Moderate',
        sizeSquareMetres: PARCEL_AREA_SQ_M
      }),
      geometry: parcel(SITE_MID_EASTING, SITE_SOUTH, SITE_EAST, SITE_NORTH)
    }
  ]
}

function hedgerows() {
  return [
    {
      properties: properties({
        ref: 'H1',
        type: 'Native hedgerow',
        condition: 'Good',
        sizeMetres: LINEAR_LENGTH_M
      }),
      geometry: eastWestLine(SITE_NORTH)
    }
  ]
}

function watercourses() {
  return [
    {
      properties: properties({
        ref: 'W1',
        type: 'Ditches',
        condition: 'Moderate',
        sizeMetres: LINEAR_LENGTH_M
      }),
      geometry: eastWestLine(SITE_MID_NORTHING)
    }
  ]
}

function trees() {
  return [
    {
      properties: properties({
        ref: 'T1',
        type: 'Urban tree',
        condition: 'Good'
      }),
      geometry: {
        type: 'MultiPoint',
        coordinates: [[SITE_MID_EASTING, SITE_MID_NORTHING]]
      }
    }
  ]
}

const BASELINE_UNITS = Object.freeze({
  habitatsTotal: 12.5,
  treesTotal: 0.5,
  hedgerowsTotal: 2,
  watercoursesTotal: 1
})

const POST_INTERVENTION_UNITS = Object.freeze({
  habitatsTotal: 18.5,
  treesTotal: 0.5,
  hedgerowsTotal: 2,
  watercoursesTotal: 1
})

function baselineSite(overrides = {}) {
  return {
    siteName: 'Test Farm',
    units: { ...BASELINE_UNITS },
    redLine: { geometry: RED_LINE },
    redLineAreaSqm: SITE_AREA_SQ_M,
    layers: {
      habitats: habitats(),
      hedgerows: hedgerows(),
      watercourses: watercourses(),
      trees: trees()
    },
    ...overrides
  }
}

/**
 * The post-intervention side: the same ground, with A2 becoming something
 * better, which is what the report is for.
 */
function postInterventionSite() {
  const site = baselineSite()
  site.layers.habitats[1].properties.type = 'Other neutral grassland'
  site.layers.habitats[1].properties.condition = 'Good'
  site.units = { ...POST_INTERVENTION_UNITS }

  // How the number was arrived at. These exist ONLY after intervention — a
  // baseline parcel is not being created or enhanced, so it has no difficulty,
  // no time to target and nothing to advance or delay. Putting them on the
  // baseline fixture would test a shape the service never produces.
  Object.assign(site.layers.habitats[0].properties, {
    difficulty: 'Medium',
    difficultyMultiplier: 0.67,
    // Both as the engine actually writes them on a real upload: the standard
    // time as a numeric STRING, the final time already worded and carrying the
    // time multiplier it used.
    standardTimeToTargetCondition: '10',
    finalTimeToTargetCondition: '8 years (0.7002822742)',
    advanceOrDelay: 'Advance - 2 years'
  })
  return site
}

export { RED_LINE, baselineSite, parcel, postInterventionSite }
