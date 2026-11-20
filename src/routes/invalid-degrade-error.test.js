import { describe, expect, test } from 'vitest'

import { ERROR_CODES } from '../validation/geopackage/errors.js'
import { invalidDegradeError } from './invalid-degrade-error.js'

describe('invalidDegradeError', () => {
  test.each([
    [
      'tree',
      ERROR_CODES.TREE_DEGRADE_NOT_VALID,
      /The tree is its baseline tree/
    ],
    [
      'habitat',
      ERROR_CODES.HABITAT_DEGRADE_NOT_VALID,
      /The habitat is its baseline habitat/
    ],
    [
      'hedgerow',
      ERROR_CODES.HABITAT_DEGRADE_NOT_VALID,
      /The habitat is its baseline habitat/
    ],
    [
      'verticalHabitat',
      ERROR_CODES.HABITAT_DEGRADE_NOT_VALID,
      /The habitat is its baseline habitat/
    ]
  ])(
    'refuses a %s’s edit as 422 %s, naming the rule',
    (type, code, message) => {
      const err = invalidDegradeError('degrade-worse-condition', type)

      expect(err.output.statusCode).toBe(422)
      expect(err.output.payload).toMatchObject({
        code,
        rule: 'degrade-worse-condition'
      })
      expect(err.message).toMatch(message)
    }
  )
})
