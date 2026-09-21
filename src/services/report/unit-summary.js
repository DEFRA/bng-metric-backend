/**
 * The project summary figures, shaped the way the service's own project
 * summary screen shapes them.
 *
 * **Nothing here calculates the metric.** Every number is the engine's,
 * computed when the project was calculated and persisted on the project
 * document: `utilities/features/feature-set-units.js` sums each layer's
 * feature units into `units`, then folds in the engine's
 * `calculatePostInterventionNetUnitChanges` — so `habitatsNetUnitChange`,
 * `habitatsNetUnitChangePercentage` and their hedgerow and watercourse
 * counterparts are already there to be read. This module only decides how
 * they are worded and whether the target was met, which is what makes the
 * report's first page and the screen it mirrors say the same thing.
 *
 * **Where this belongs, eventually.** The identical rules live in the
 * frontend today, in `src/server/common/helpers/unit-summary.js` — this is a
 * second copy of them, written deliberately and against the grain, because a
 * PDF is rendered here and the screen is rendered there. The rules are small
 * and stable, and every one of them is pinned by a test next door, but two
 * copies can still drift. Worth revisiting as: hoisting the figures into
 * bng-library beside the engine (the GOV.UK tag classes and hrefs would stay
 * in the frontend, being presentation), or serving the shaped summary from
 * this service's project API so the screen reads it rather than deriving it.
 * Either is a bigger change than the report should carry; whoever needs that
 * decision made should make it on its own merits.
 *
 * The rules that are easy to get subtly wrong, all copied on purpose:
 *
 *  - **Area habitats include individual trees.** The metric treats them as
 *    one module even though the totals are stored separately.
 *  - **The target is judged on the ROUNDED percentage.** 9.995% displays as
 *    "10.00%", and a tile reading 10.00% beside a red "Not met" would look
 *    like a bug whichever way round it was decided.
 *  - **A baseline with no post-intervention is -100%, not "unknown".** The
 *    site's units all go and nothing replaces them, which is what the screen
 *    says too.
 *  - **A habitat type that exists only after intervention is "Not
 *    applicable".** There is no baseline to improve on, so a percentage
 *    change of any value would be a fiction.
 */

/** The statutory net gain. No project carries a target of its own yet. */
const NET_GAIN_TARGET_PERCENTAGE = 10

/**
 * The area module's key. Named because two rules turn on it: it is the unit
 * type always shown, and the one never treated as post-intervention-only.
 */
const AREA_HABITATS_KEY = 'habitats'

const SIGNIFICANT_FIGURES = 15
const DECIMAL_PLACES = 2
const ZERO_UNITS_DISPLAY = '0.00'
const NEGATIVE_ZERO_UNITS_DISPLAY = '-0.00'
const NO_POST_INTERVENTION_PERCENTAGE = -100
const NOT_AVAILABLE = 'N/A'
const NOT_APPLICABLE = 'Not applicable'

const MET = 'Met'
const NOT_MET = 'Not met'

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function normaliseUnits(value) {
  return isFiniteNumber(value) ? value : 0
}

/**
 * Two decimal places, via 15 significant figures.
 *
 * The intermediate `toPrecision` is the frontend's, kept because matching the
 * screen exactly is the whole point of this module. On the evidence it
 * changes nothing: no value differed from a plain `toFixed(2)` across three
 * million random figures or every `.005` boundary up to 1000. It is carried
 * anyway rather than tidied away, because dropping it would be a silent
 * divergence from the code this has to agree with, and the place to remove it
 * is there, from both at once.
 *
 * `-0.00` is written as `0.00`: a net change of nothing is not a loss.
 */
function formatUnits(value) {
  const rounded = Number(normaliseUnits(value).toPrecision(SIGNIFICANT_FIGURES))
  const formatted = rounded.toFixed(DECIMAL_PLACES)
  return formatted === NEGATIVE_ZERO_UNITS_DISPLAY
    ? ZERO_UNITS_DISPLAY
    : formatted
}

function formatOptionalUnits(value) {
  return isFiniteNumber(value) ? `${formatUnits(value)} units` : NOT_AVAILABLE
}

/** Area habitats and individual trees are one metric module. */
function areaUnits(units, missingValue = 0) {
  const habitatsTotal = units?.habitatsTotal
  const treesTotal = units?.treesTotal

  if (!isFiniteNumber(habitatsTotal) && !isFiniteNumber(treesTotal)) {
    return missingValue
  }
  return normaliseUnits(habitatsTotal) + normaliseUnits(treesTotal)
}

/**
 * The three unit types the summary screen shows, in its order, each knowing
 * where its own figures are kept on the document.
 *
 * Individual trees have no section of their own — they are counted inside
 * area habitats, above.
 */
const UNIT_TYPES = Object.freeze([
  Object.freeze({
    key: 'habitats',
    title: 'Area habitats',
    baselineOf: (units) => areaUnits(units),
    interventionOf: (units) => ({
      units: areaUnits(units, null),
      netUnitChange: units?.habitatsNetUnitChange,
      netPercentageChange: units?.habitatsNetUnitChangePercentage
    })
  }),
  Object.freeze({
    key: 'hedgerows',
    title: 'Hedgerows',
    baselineOf: (units) => units?.hedgerowsTotal,
    interventionOf: (units) => ({
      units: units?.hedgerowsTotal,
      netUnitChange: units?.hedgerowsNetUnitChange,
      netPercentageChange: units?.hedgerowsNetUnitChangePercentage
    })
  }),
  Object.freeze({
    key: 'watercourses',
    title: 'Watercourses',
    baselineOf: (units) => units?.watercoursesTotal,
    interventionOf: (units) => ({
      units: units?.watercoursesTotal,
      netUnitChange: units?.watercoursesNetUnitChange,
      netPercentageChange: units?.watercoursesNetUnitChangePercentage
    })
  })
])

/**
 * The percentage, and whether it met the target.
 *
 * `status` is null where there is nothing to judge — an unassessable change
 * is not the same as an assessed failure, and a red "Not met" beside a value
 * that already reads "N/A" would say it was.
 */
function percentageSummary(value) {
  if (!isFiniteNumber(value)) {
    return { netPercentageChange: NOT_AVAILABLE, status: null }
  }

  const formatted = formatUnits(value)
  const met = Number(formatted) >= NET_GAIN_TARGET_PERCENTAGE
  return {
    netPercentageChange: `${formatted}%`,
    status: { text: met ? MET : NOT_MET, met }
  }
}

/**
 * Whether a unit type appears at all.
 *
 * Area habitats always do. The two linear types appear only where the project
 * holds features of that kind on one side or the other, which is the rule the
 * summary screen uses — an empty Hedgerows section on a site with no hedges
 * would be three tiles of zeroes saying nothing.
 */
function isVisible(key, baseline, postIntervention) {
  if (key === AREA_HABITATS_KEY) {
    return true
  }
  return [baseline, postIntervention].some(
    (side) => (side?.documentCounts?.[key] ?? 0) > 0
  )
}

/**
 * Whether a unit type exists only after intervention — so there is no
 * baseline to improve on and a percentage change would be a fiction.
 *
 * **Never true for area habitats**, which is what the summary screen does: it
 * passes this flag for hedgerows and watercourses only, and lets the area
 * entry default to false (`buildProjectUnitTypes` in the frontend's
 * project-summary controller). The area module is the one every project
 * starts with — the baseline upload IS the area file — so "the site had none
 * of these before" is not a state it reaches.
 *
 * Asking the question of area habitats was also unanswerable from a feature
 * count, which is how the divergence showed up in review on #297: `habitats`
 * here names the whole area module, individual trees included, so a project
 * whose baseline held one tree and no polygons was labelled "Not applicable"
 * beside its own baseline of 1.00 units and a real percentage from the
 * engine. Exempting the module fixes that at the root rather than widening
 * the count to trees and leaving the rule applied where the screen does not
 * apply it.
 */
function onlyAfterIntervention(key, baseline, postIntervention) {
  if (key === AREA_HABITATS_KEY) {
    return false
  }
  return (
    (baseline?.documentCounts?.[key] ?? 0) === 0 &&
    (postIntervention?.documentCounts?.[key] ?? 0) > 0
  )
}

/**
 * One summary per visible unit type, ready to draw.
 *
 * @param {object|null} baseline          site model from site-data.js
 * @param {object|null} postIntervention  site model, or null
 * @returns {Array<{key: string, title: string, netPercentageChange: string,
 *                  status: {text: string, met: boolean}|null,
 *                  baselineUnits: string, postInterventionHeading: string,
 *                  postInterventionUnits: string, netUnitChange: string}>}
 */
function summariseUnitTypes(baseline, postIntervention) {
  return UNIT_TYPES.filter((unitType) =>
    isVisible(unitType.key, baseline, postIntervention)
  ).map((unitType) => summariseUnitType(unitType, baseline, postIntervention))
}

function summariseUnitType(unitType, baseline, postIntervention) {
  const postInterventionOnly = onlyAfterIntervention(
    unitType.key,
    baseline,
    postIntervention
  )
  const intervention = postIntervention
    ? unitType.interventionOf(postIntervention.units)
    : null

  const baselineUnits = normaliseUnits(unitType.baselineOf(baseline?.units))
  const { percentage, netUnitChange } = changeAgainstBaseline(
    baselineUnits,
    intervention
  )

  return {
    key: unitType.key,
    title: unitType.title,
    ...(postInterventionOnly
      ? { netPercentageChange: NOT_APPLICABLE, status: null }
      : percentageSummary(percentage)),
    baselineUnits: `${formatUnits(baselineUnits)} units`,
    // The screen hyphenates the heading only where a comparable
    // post-intervention file was supplied; the two spellings are how it
    // distinguishes "after the work" from "the only file there is".
    postInterventionHeading:
      intervention && !postInterventionOnly
        ? 'On-site post-intervention'
        : 'On-site post intervention',
    postInterventionUnits: intervention
      ? formatOptionalUnits(intervention.units)
      : `${ZERO_UNITS_DISPLAY} units`,
    netUnitChange: intervention
      ? formatOptionalUnits(netUnitChange)
      : `${formatUnits(netUnitChange)} units`,
    tradingRulesStatus: tradingRulesStatusFor(unitType.key, postIntervention)
  }
}

/**
 * The trading-rules status to show for a unit type, or null for no tag.
 *
 * Unlike every other figure on this page, this one is not shaped here and is
 * not a second copy of a frontend rule: the status is derived once by
 * bng-library and stored on the document, and both this report and the screen
 * read the same stored value. Deriving it twice is what the rule is designed to
 * prevent — the Low band figure deliberately ignores a Medium deficit the
 * metric spreadsheet nets off, and is only safe read alongside the Medium band.
 *
 * Only area habitats carry one so far. Hedgerow and watercourse trading rules
 * are separate work, and their tiles stay untagged until they land.
 *
 * @param {string} key the unit type
 * @param {object} postIntervention the stored post-intervention document
 * @returns {{ text: string, met: boolean }|null}
 */
function tradingRulesStatusFor(key, postIntervention) {
  if (key !== AREA_HABITATS_KEY) {
    return null
  }
  // With no post-intervention document there is nothing to trade against, and
  // the report says so — matching the screen, which shows the same.
  if (!postIntervention) {
    return { text: NOT_MET, met: false }
  }

  const status = postIntervention.tradingRules?.areaHabitats?.statuses?.overall
  if (status !== MET && status !== NOT_MET) {
    return null
  }
  return { text: status, met: status === MET }
}

/**
 * With no post-intervention file, the change is not unknown — it is the loss
 * of the whole baseline: every unit on the site goes and nothing replaces it.
 * A zero baseline is the one case with no percentage, there being nothing to
 * be a percentage of.
 */
function changeAgainstBaseline(baselineUnits, intervention) {
  if (intervention) {
    return {
      percentage: intervention.netPercentageChange,
      netUnitChange: intervention.netUnitChange
    }
  }
  return {
    percentage: baselineUnits > 0 ? NO_POST_INTERVENTION_PERCENTAGE : null,
    netUnitChange: -baselineUnits
  }
}

export {
  NET_GAIN_TARGET_PERCENTAGE,
  UNIT_TYPES,
  areaUnits,
  formatOptionalUnits,
  formatUnits,
  percentageSummary,
  summariseUnitTypes
}
