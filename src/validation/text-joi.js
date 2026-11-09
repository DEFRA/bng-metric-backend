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
  textLimitOf
} from './geopackage/text-limits.js'
import { INDIVIDUAL_TREES_BROAD_HABITAT } from './geopackage/tree-constants.js'
import { getHabitatsByBroad } from './reference/habitat-reference.js'
import { VERTICAL_BROAD_HABITATS } from './reference/vertical-habitats.js'

/**
 * Joi with a string rule, `.maxCharacters()`, that counts characters (Unicode
 * code points), as the upload's limits do (BMD-1175). Joi's own `.max()`
 * counts UTF-16 code units, so it would refuse a reference of 99 emoji that
 * the upload accepts. The data dictionary shows the rule as
 * `max 99 characters`.
 */
const textJoi = Joi.extend((joi) => ({
  type: 'string',
  base: joi.string(),
  messages: {
    'string.maxCharacters': '{{#label}} must be {{#limit}} characters or fewer'
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
        return Array.from(value).length > limit
          ? helpers.error('string.maxCharacters', { limit })
          : value
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

/** The stored fields LISTED_FIELDS limits to a list, by name. */
export const LISTED_FIELD_NAMES = Object.freeze(
  new Set(Object.keys(LISTED_FIELDS))
)

const NULL_WORD = 'Null'

// A legacy list number, as in "4. Fairly Poor": the import stores the words.
const LIST_NUMBER = /^\d+\.\s*/

function listValues(columns) {
  const byKey = new Map(
    Object.entries(TEMPLATE_ALLOWED_VALUES).map(([column, values]) => [
      column.trim(),
      values
    ])
  )
  return columns.flatMap((column) =>
    (byKey.get(column) ?? []).flatMap((value) => {
      const words = value.replace(LIST_NUMBER, '')
      // Riparian encroachment pairs are spelt "Minor/ Minor" and "Minor/Minor".
      const unspaced = words
        .split('/')
        .map((part) => part.trim())
        .join('/')
      return [value, words, unspaced]
    })
  )
}

/**
 * A stored value from a drop-down or filled-in column (BMD-1175 AC9): no
 * longer than its column's limit, and one of the words its lists offer in
 * either template, or one the service stores there itself, in any case.
 * Null or empty is allowed. The upload refuses a value outside the lists
 * first, with VALUE_NOT_ALLOWED; this keeps the stored document, and the
 * API documentation generated from it, to the same words.
 *
 * @param {keyof typeof LISTED_FIELDS} field
 */
export function listedFileText(field) {
  const { columns, stored = () => [] } = LISTED_FIELDS[field]
  // "Null" is the word GIS tools write for a missing value; the upload reads
  // it as blank, and the import can keep it.
  const values = [
    ...new Set([...listValues(columns), ...stored(), NULL_WORD])
  ].sort()
  return fileText(textLimitOf(columns[0]))
    .valid(...values)
    .insensitive()
}
