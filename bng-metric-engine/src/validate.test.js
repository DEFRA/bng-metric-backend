import { describe, expect, it, vi } from 'vitest'

import * as referenceConstants from './reference-constants.js'
import {
  validateCondition,
  validateHabitat,
  validateHabitatChange,
  validateSize,
  validateYears
} from './validate.js'

const VALID_HABITAT = 'Grassland - Modified grassland'

describe('validateSize', () => {
  it('accepts a positive finite number', () => {
    expect(() => validateSize(0.01)).not.toThrow()
  })

  it('rejects non-number, non-finite, zero, and negative', () => {
    expect(() => validateSize(Number.NaN)).toThrow(
      'Size must be a finite number greater than 0'
    )
    expect(() => validateSize(Infinity)).toThrow(
      'Size must be a finite number greater than 0'
    )
    expect(() => validateSize(0)).toThrow(
      'Size must be a finite number greater than 0'
    )
    expect(() => validateSize(-1)).toThrow(
      'Size must be a finite number greater than 0'
    )
    expect(() => validateSize('1')).toThrow(
      'Size must be a finite number greater than 0'
    )
  })
})

describe('validateHabitat', () => {
  it('accepts a statutory habitat key', () => {
    expect(() => validateHabitat(VALID_HABITAT)).not.toThrow()
  })

  it('rejects nullish and empty string', () => {
    expect(() => validateHabitat(null)).toThrow('habitat not specified')
    expect(() => validateHabitat(undefined)).toThrow('habitat not specified')
    expect(() => validateHabitat('')).toThrow('habitat not specified')
  })

  it('rejects non-string', () => {
    expect(() => validateHabitat(1)).toThrow('Habitat must be a string')
  })

  it('rejects unknown habitat', () => {
    expect(() => validateHabitat('Not a habitat')).toThrow(
      'is not a valid habitat'
    )
  })

  it('throws when band label has no score row in reference data', () => {
    const spy = vi.spyOn(referenceConstants, 'DISTINCTIVENESS_SCORES', 'get')
    spy.mockReturnValue({})
    expect(() => validateHabitat(VALID_HABITAT)).toThrow(
      'no distinctiveness category in reference data'
    )
    spy.mockRestore()
  })
})

describe('validateCondition', () => {
  it('accepts habitat + condition present in reference data', () => {
    expect(() => validateCondition(VALID_HABITAT, 'Moderate')).not.toThrow()
  })

  it('rejects empty condition', () => {
    expect(() => validateCondition(VALID_HABITAT, '')).toThrow(
      'condition not specified'
    )
  })

  it('rejects non-string condition', () => {
    expect(() => validateCondition(VALID_HABITAT, 2)).toThrow(
      'Condition must be a string'
    )
  })

  it('rejects condition not listed for habitat', () => {
    expect(() =>
      validateCondition(VALID_HABITAT, 'Not A Real Condition')
    ).toThrow('is not a valid condition for habitat')
  })

  it('throws when habitat has no condition matrix row', () => {
    const spy = vi.spyOn(referenceConstants, 'CONDITION_SCORES', 'get')
    spy.mockReturnValue({
      ...referenceConstants.CONDITION_SCORES,
      [VALID_HABITAT]: null
    })
    expect(() => validateCondition(VALID_HABITAT, 'Moderate')).toThrow(
      'No condition reference data for habitat'
    )
    spy.mockRestore()
  })
})

describe('validateHabitatChange', () => {
  it('accepts Creation and Enhancement', () => {
    expect(() => validateHabitatChange('Creation')).not.toThrow()
    expect(() => validateHabitatChange('Enhancement')).not.toThrow()
  })

  it('rejects empty and invalid change types', () => {
    expect(() => validateHabitatChange('')).toThrow('changeType not specified')
    expect(() => validateHabitatChange('Retrofit')).toThrow(
      'is not a valid change type'
    )
  })
  it('rejects non-string change type', () => {
    expect(() => validateHabitatChange(1)).toThrow(
      'changeType must be a string'
    )
  })
})

describe('validateYears', () => {
  it('normalises legacy 30+ and numeric strings', () => {
    expect(validateYears('30+')).toBe(30)
    expect(validateYears('0')).toBe(0)
    expect(validateYears('15')).toBe(15)
    expect(validateYears(7)).toBe(7)
  })

  it('rejects nullish', () => {
    expect(() => validateYears(null)).toThrow('years not specified')
  })

  it('rejects empty trimmed string', () => {
    expect(() => validateYears('   ')).toThrow('years value is empty')
  })

  it('rejects non-numeric strings', () => {
    expect(() => validateYears('x')).toThrow('is not a valid value for years')
  })

  it('rejects non-integer and out-of-range numbers', () => {
    expect(() => validateYears(1.5)).toThrow('is not a valid number for years')
    expect(() => validateYears(31)).toThrow('is not a valid number for years')
    expect(() => validateYears(-1)).toThrow('is not a valid number for years')
  })

  it('rejects non-number non-string years including objects and symbols', () => {
    expect(() => validateYears({})).toThrow(TypeError)
    expect(() => validateYears(Symbol('y'))).toThrow(TypeError)
    expect(() => validateYears(3n)).toThrow(TypeError)
  })

  it('includes a safe description for circular objects in TypeError', () => {
    const circular = {}
    circular.self = circular
    expect(() => validateYears(circular)).toThrow(TypeError)
  })
})
