import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as turf from '@turf/turf'

import { ERROR_CODES, makeError } from '../errors.js'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const englandPath = path.join(moduleDir, '..', 'reference', 'england.geojson')
const england = JSON.parse(fs.readFileSync(englandPath, 'utf8'))

export function redlineInEngland(redlineFeatures) {
  if (!redlineFeatures || redlineFeatures.length === 0) {
    return null
  }
  for (const feature of redlineFeatures) {
    if (!turf.booleanWithin(feature, england)) {
      return makeError(
        ERROR_CODES.REDLINE_OUTSIDE_ENGLAND,
        'Redline boundary is outside England'
      )
    }
  }
  return null
}
