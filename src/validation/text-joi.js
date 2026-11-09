import Joi from 'joi'

import {
  LONG_TEXT_LIMIT,
  SHORT_TEXT_LIMIT,
  SPATIAL_RISK_LIMIT
} from './geopackage/text-limits.js'

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
