/**
 * Joi validation schemas for the trading-rules unit figures stored in
 * `project.postIntervention.tradingRules`, one per feature module: area
 * habitats, watercourses and hedgerows. Unit values only — the Met / Not-met
 * statuses are derived on read, not stored.
 *
 * Composed into postInterventionDataSchema by
 * project-post-intervention-schema.js, and used directly by persist-project.js
 * to validate the trading-rules fragment it writes.
 */
import Joi from 'joi'

import { tradingRulesHabitatNetChangeSchema } from '../project-shared-schemas.js'

const watercourseTradingRulesHabitatSchema = Joi.object({
  habitatType: Joi.string()
    .required()
    .description(
      'Watercourse type the net unit change is aggregated for (e.g. "Ditches", "Canals", "Culvert").'
    ),
  distinctiveness: Joi.string()
    .required()
    .description(
      'Distinctiveness band resolved by bng-library/metric for the watercourse type (e.g. "Medium", "Low").'
    ),
  netUnitChange: Joi.number()
    .required()
    .description(
      'Net unit change for the watercourse type: summed retained + created + enhanced post-intervention units (attributed to the proposed habitat) minus summed baseline units. Positive is a surplus, negative a deficit.'
    )
}).description(
  'Net unit change for a single watercourse type across baseline and post-intervention (BMD-995 AC1).'
)

const watercourseTradingRulesSchema = Joi.object({
  habitats: Joi.array()
    .items(watercourseTradingRulesHabitatSchema)
    .description(
      'Per-habitat-type net unit change across baseline and post-intervention watercourses (AC1). One entry per unique watercourse type, ordered by type.'
    ),
  medium: Joi.object({
    surplus: Joi.number()
      .required()
      .description(
        'Total surplus for Medium-distinctiveness watercourses: the sum of Medium net unit changes greater than zero (AC2). Zero or positive.'
      ),
    deficit: Joi.number()
      .required()
      .description(
        'Total deficit for Medium-distinctiveness watercourses: the sum of Medium net unit changes less than zero (AC3). Zero or negative.'
      )
  }).description(
    'Medium-distinctiveness watercourse band aggregates (AC2, AC3).'
  ),
  low: Joi.object({
    netUnitChange: Joi.number()
      .required()
      .description(
        'Net change in units for Low-distinctiveness watercourses: the sum of all Low net unit changes regardless of sign (AC4).'
      ),
    cumulativeAvailability: Joi.number()
      .required()
      .description(
        'Cumulative availability of units for Low-distinctiveness watercourses: the Medium surplus (AC2) plus the Low net change (AC4), per AC5.'
      )
  }).description('Low-distinctiveness watercourse band aggregates (AC4, AC5).')
}).description(
  'Watercourse trading-rules unit figures (BMD-995). Unit values only; Met/Not-met statuses are derived separately (BMD-1002).'
)

const areaHabitatTradingRulesSchema = Joi.object({
  habitatTypes: Joi.array()
    .items(tradingRulesHabitatNetChangeSchema)
    .description(
      'Net unit change per habitat type across baseline and post-intervention area habitats, individual trees included. One entry per unique habitat TYPE, not per feature — the units of every parcel and tree of a type are summed first. Ordered by habitat type, Medium and Low bands only: Very Low habitats hold no units to trade, and the metric defines no traded figure for High or Very High.'
    ),
  medium: Joi.object({
    broadHabitats: Joi.array()
      .items(
        Joi.object({
          broadHabitat: Joi.string()
            .required()
            .description(
              'Broad habitat the Medium net unit changes are cumulated under. "Intertidal sediment and hard structures" is the merged group the two intertidal broad habitats share: the trading rules treat them as one broad habitat.'
            ),
          netUnitChange: Joi.number()
            .required()
            .description(
              'Sum of the net unit changes of the Medium habitats in this broad habitat.'
            )
        })
      )
      .description(
        'Cumulative change per broad habitat for the Medium band, with intertidal sediment and intertidal hard structures merged into one entry. Ordered by broad habitat. Medium distinctiveness trades at broad-habitat level, which is why the band is aggregated this way and the two other bands are not.'
      ),
    surplus: Joi.number()
      .required()
      .description(
        'Total surplus for Medium-distinctiveness area habitats: the sum of the broad habitats whose cumulative change is greater than zero. Zero or positive. Taken over broad habitats, not habitats, so a surplus and a deficit within one broad habitat cancel before they count.'
      ),
    deficit: Joi.number()
      .required()
      .description(
        'Total deficit for Medium-distinctiveness area habitats: the sum of the broad habitats whose cumulative change is less than zero. Zero or negative.'
      )
  }).description(
    'Medium-distinctiveness band totals. This band trades at broad-habitat level, so the figures are taken over broad habitats rather than habitat types.'
  ),
  low: Joi.object({
    netUnitChange: Joi.number()
      .required()
      .description(
        'Net change in units for Low-distinctiveness area habitats: the sum of all Low net unit changes regardless of sign. Low trades on distinctiveness alone, so there is no broad-habitat constraint and no per-broad-habitat breakdown.'
      ),
    cumulativeAvailability: Joi.number()
      .required()
      .description(
        'Units available to the Low band once the Medium surplus is carried down: the Medium surplus plus the Low net change. Deliberately NOT the Statutory Metric\'s "Cumulative surplus of units", which cancels the Medium deficit against the Medium surplus first and so is always lower by the size of that deficit — 23.1012 against 32.5222 on the worked example. The trading rules do not permit that cancellation: a surplus in one broad habitat cannot make good a deficit in another. This figure is therefore not safe to judge compliance on alone; the Medium band has to be accounted for in its own right.'
      )
  }).description(
    'Low-distinctiveness band totals. This band trades on distinctiveness alone, with no broad-habitat constraint.'
  )
}).description(
  'Area-habitat trading-rules unit figures. The Met / Not-met statuses are a pure function of these and are derived on read, not stored.'
)

const hedgerowTradingRulesHabitatTypeSchema = Joi.object({
  habitatType: Joi.string()
    .required()
    .description(
      'Hedgerow habitat type the net unit change is aggregated for, as the bng-library/metric hedgerow reference key (e.g. "Native hedgerow", "Line of trees - associated with bank or ditch").'
    ),
  distinctiveness: Joi.string()
    .required()
    .description(
      'Distinctiveness band resolved from the bng-library/metric hedgerow reference data. Only "Medium", "Low" and "V.Low" appear: the metric defines no traded figure for High or Very High hedgerows.'
    ),
  netUnitChange: Joi.number()
    .required()
    .description(
      'Net unit change for the hedgerow type: summed retained + created + enhanced post-intervention units (retained hedgerows under their baseline type, created and enhanced under their proposed type) minus summed baseline units. Positive is a gain, negative a loss.'
    )
}).description(
  'Net unit change for a single hedgerow habitat type across baseline and post-intervention.'
)

const hedgerowTradingRulesSchema = Joi.object({
  habitatTypes: Joi.array()
    .items(hedgerowTradingRulesHabitatTypeSchema)
    .description(
      'Net unit change per hedgerow habitat type across baseline and post-intervention. One entry per unique habitat TYPE, not per feature. Ordered by habitat type; Medium, Low and Very Low bands only.'
    ),
  medium: Joi.object({
    netUnitChange: Joi.number()
      .required()
      .description(
        'Net change in units for Medium-distinctiveness hedgerows: the sum of all Medium net unit changes regardless of sign. Hedgerows trade on distinctiveness band alone, so a gain in one Medium type offsets a loss in another — unlike area habitats and watercourses, which carry only the Medium surplus.'
      )
  }).description('Medium-distinctiveness hedgerow band totals.'),
  low: Joi.object({
    netUnitChange: Joi.number()
      .required()
      .description(
        'Net change in units for Low-distinctiveness hedgerows: the sum of all Low net unit changes regardless of sign.'
      ),
    cumulativeAvailability: Joi.number()
      .required()
      .description(
        "Units available to the Low band: the Low net change plus the Medium net change when that is greater than zero. A Medium loss is never carried down. Matches the Statutory Metric's Trading Summary Hedgerows sheet."
      )
  }).description('Low-distinctiveness hedgerow band totals.'),
  veryLow: Joi.object({
    netUnitChange: Joi.number()
      .required()
      .description(
        'Net change in units for Very Low-distinctiveness hedgerows: the sum of all Very Low net unit changes regardless of sign.'
      ),
    cumulativeAvailability: Joi.number()
      .required()
      .description(
        "Units available to the Very Low band: the Very Low net change plus the Low cumulative availability when that is greater than zero. A shortfall is never carried down. Matches the Statutory Metric's Trading Summary Hedgerows sheet."
      )
  }).description('Very Low-distinctiveness hedgerow band totals.')
}).description(
  'Hedgerow trading-rules unit figures. Unit values only; Met / Not-met statuses are derived separately, not stored.'
)

const tradingRulesSchema = Joi.object({
  areaHabitats: areaHabitatTradingRulesSchema,
  watercourses: watercourseTradingRulesSchema,
  hedgerows: hedgerowTradingRulesSchema
}).description(
  'Trading-rules unit figures by feature module: area habitats, watercourses and hedgerows.'
)

export { tradingRulesSchema }
