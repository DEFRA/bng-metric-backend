import Joi from 'joi'

import { TEMPLATE_ALLOWED_VALUES } from 'bng-library/bng-service'
import {
  CONDITION_SCORES,
  HEDGEROW_CONDITION_SCORES,
  WATERCOURSE_CONDITION_SCORES,
  WATERCOURSE_ENCROACHMENT_MULTIPLIER,
  WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER
} from 'bng-library/metric'

import {
  LONG_TEXT_LIMIT,
  SHORT_TEXT_LIMIT,
  SPATIAL_RISK_LIMIT,
  allowedValuesOf,
  characterCount,
  isNullWord,
  normaliseListValue,
  textLimitOf
} from './geopackage/text-limits.js'
import { INDIVIDUAL_TREES_BROAD_HABITAT } from './geopackage/tree-constants.js'
import { getHabitatsByBroad } from './reference/habitat-reference.js'
import { VERTICAL_BROAD_HABITATS } from './reference/vertical-habitats.js'

/**
 * Joi with two string rules that check a stored value exactly as the upload
 * checks it (text-values-gate.js), so that a file the upload accepts is never
 * refused when its document is saved (BMD-1175):
 *
 * - `.maxCharacters(limit)` counts characters (Unicode code points) once
 *   leading and trailing whitespace is removed. Joi's own `.max()` counts
 *   UTF-16 code units and does not trim.
 * - `.inList(values, allowed)` accepts a value whose normalised form
 *   (normaliseListValue) is in `allowed`, a blank one, or "Null". `values`
 *   are the words shown in the data dictionary.
 */
const textJoi = Joi.extend((joi) => ({
  type: 'string',
  base: joi.string(),
  messages: {
    'string.maxCharacters': '{{#label}} must be {{#limit}} characters or fewer',
    'string.inList': '{{#label}} must be a value its lists offer'
  },
  rules: {
    maxCharacters: {
      method(limit) {
        return this.$_addRule({ name: 'maxCharacters', args: { limit } })
      },
      args: [
        {
          name: 'limit',
          assert: (value) => Number.isSafeInteger(value) && value >= 0,
          message: 'must be a non-negative integer'
        }
      ],
      validate(value, helpers, { limit }) {
        return characterCount(value) > limit
          ? helpers.error('string.maxCharacters', { limit })
          : value
      }
    },
    inList: {
      method(values, allowed) {
        return this.$_addRule({ name: 'inList', args: { values, allowed } })
      },
      args: [
        { name: 'values', assert: Array.isArray, message: 'must be an array' },
        {
          name: 'allowed',
          assert: (value) => value instanceof Set,
          message: 'must be a Set'
        }
      ],
      validate(value, helpers, { allowed }) {
        const blank = value.trim() === '' || isNullWord(value)
        return blank || allowed.has(normaliseListValue(value))
          ? value
          : helpers.error('string.inList')
      }
    }
  }
}))

/**
 * A stored text value read from an uploaded file, no longer than `limit`
 * characters, null or empty allowed.
 *
 * @param {number} limit
 */
export function fileText(limit) {
  return textJoi.string().maxCharacters(limit).allow(null, '')
}

export const shortFileText = () => fileText(SHORT_TEXT_LIMIT)
export const longFileText = () => fileText(LONG_TEXT_LIMIT)
export const spatialRiskFileText = () => fileText(SPATIAL_RISK_LIMIT)

const conditionsOf = (table) =>
  Object.values(table).flatMap((row) => Object.keys(row))

/**
 * The stored fields that hold a value from a drop-down or filled-in column,
 * each with the template columns its value comes from and the words the
 * service itself stores there: the engine's names, which an edit on screen
 * saves, and the words the import normalises a file's value to.
 */
const LISTED_FIELDS = Object.freeze({
  broadType: {
    columns: ['Baseline Broad Habitat Type', 'Proposed Broad Habitat Type'],
    stored: () => [
      ...getHabitatsByBroad().map((row) => row.broadHabitat),
      ...VERTICAL_BROAD_HABITATS,
      INDIVIDUAL_TREES_BROAD_HABITAT
    ]
  },
  condition: {
    columns: ['Baseline Condition', 'Proposed Condition'],
    stored: () => [
      ...conditionsOf(CONDITION_SCORES),
      ...conditionsOf(HEDGEROW_CONDITION_SCORES),
      ...conditionsOf(WATERCOURSE_CONDITION_SCORES)
    ]
  },
  strategicSignificance: {
    columns: [
      'Baseline Strategic Significance',
      'Proposed Strategic Significance'
    ]
  },
  retentionCategory: { columns: ['Retention Category'] },
  spatialRiskCategory: { columns: ['Spatial risk category'] },
  location: { columns: ['Location'] },
  rawDistinctiveness: {
    columns: ['Baseline Distinctiveness', 'Proposed Distinctiveness']
  },
  treeSize: { columns: ['Baseline Tree Size', 'Proposed Tree Size'] },
  treeSpecies: { columns: ['Baseline Tree Type', 'Proposed Tree Type'] },
  ruralOrUrban: {
    columns: ['Baseline Rural or Urban Tree', 'Proposed Rural or Urban Tree']
  },
  watercourseEncroachment: {
    columns: [
      'Baseline Encroachment into Watercourse',
      'Proposed Encroachment into Watercourse'
    ],
    stored: () => Object.keys(WATERCOURSE_ENCROACHMENT_MULTIPLIER)
  },
  riparianEncroachment: {
    columns: [
      'Baseline Encroachment into riparian zone',
      'Proposed Encroachment into riparian zone'
    ],
    stored: () => Object.keys(WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER)
  },
  enhancementType: { columns: ['Enhancement Type'] },
  habitatCreatedInAdvanceYears: {
    columns: [
      'Habitat created in advance/years',
      'Habitat Created/Enhanced in advance/years'
    ]
  },
  delayInStartingHabitatCreationYears: {
    columns: [
      'Delay in starting habitat creation/years',
      'Delay in starting habitat creation/enhancement in years'
    ]
  }
})

// A legacy list number, as in "4. Fairly Poor".
const LIST_NUMBER = /^\d+\.(?!\d)\s*/

/** The words a field's lists offer, without list numbers, for the data dictionary. */
function shownWords(columns) {
  const words = columns.flatMap((column) =>
    Object.entries(TEMPLATE_ALLOWED_VALUES)
      .filter(([name]) => name.trim() === column)
      .flatMap(([, values]) => values.map((v) => v.replace(LIST_NUMBER, '')))
  )
  return [...new Set(words)].sort((a, b) => a.localeCompare(b))
}

/**
 * A stored value from a drop-down or filled-in column (BMD-1175 AC9): no
 * longer than its column's limit, and one of the words its lists offer in
 * either template, or one the service stores there itself, compared as the
 * upload compares it. Blank, null or "Null" is allowed. The upload refuses a
 * value outside the lists first, with VALUE_NOT_ALLOWED; this keeps the
 * stored document, and the API documentation generated from it, to the same
 * words.
 *
 * @param {keyof typeof LISTED_FIELDS} field
 */
export function listedFileText(field) {
  const { columns, stored = () => [] } = LISTED_FIELDS[field]
  // The same lists the upload checks against, joined per column, plus the
  // words the service stores there itself, all normalised as the upload
  // normalises a value.
  const allowed = new Set([
    ...columns.flatMap((column) => [...(allowedValuesOf(column) ?? [])]),
    ...stored().map(normaliseListValue)
  ])
  return fileText(textLimitOf(columns[0])).inList(shownWords(columns), allowed)
}
