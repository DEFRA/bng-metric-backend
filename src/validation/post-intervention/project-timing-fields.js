import Joi from 'joi'

export function createdTimingSelectionFields() {
  return {
    advanceYearsIs30Plus: Joi.boolean().description(
      'Whether a Created feature editor selected 30+ for advance; numeric advanceYears remains 30.'
    ),
    delayYearsIs30Plus: Joi.boolean().description(
      'Whether a Created feature editor selected 30+ for delay; numeric delayYears remains 30.'
    )
  }
}
