import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ERROR_CODES, makeError } from '../../src/validation/baseline/errors.js'

export const LAYER_RLB = 'Red Line Boundary'
export const LAYER_HABITATS = 'Habitats'
export const ALL_LAYERS = [LAYER_RLB, LAYER_HABITATS]

/** Optional layers used to exercise readBaselineGeoPackage resolution */
export const FULL_READ_LAYERS = [
  LAYER_RLB,
  LAYER_HABITATS,
  'Hedgerows',
  'Rivers',
  'Urban Trees'
]

export const TEST_SW_EASTING = 400000
export const TEST_SW_NORTHING = 100000
export const TEST_NE_EASTING = 400100
export const TEST_NE_NORTHING = 100100
export const TEST_MID_EASTING = 400050
export const TEST_MID_NORTHING = 100050
export const TEST_QUARTER_EASTING = 400025
export const TEST_QUARTER_NORTHING = 100025

export const baselineSchema = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'src',
      'validation',
      'baseline',
      'reference',
      'baseline-template.schema.json'
    ),
    'utf8'
  )
)

export const missingLayerError = (name) =>
  makeError(
    ERROR_CODES.GPKG_MISSING_LAYER,
    `Missing required feature layer in GeoPackage: ${name}`
  )

export const ERR_ZERO_RLB = makeError(
  ERROR_CODES.GPKG_RLB_NO_POLYGON,
  'Zero red line boundaries in GeoPackage (expecting one)'
)

export const ERR_UNREADABLE_RLB = makeError(
  ERROR_CODES.GPKG_RLB_UNREADABLE_GEOMETRY,
  'Red Line Boundary contains unreadable geometry'
)

export const ERR_ZERO_HABITATS = makeError(
  ERROR_CODES.NO_HABITAT_AREAS,
  'Zero area habitat parcels in GeoPackage (expecting at least one)'
)

export const ERR_UNREADABLE_HABITATS = makeError(
  ERROR_CODES.GPKG_HABITATS_UNREADABLE_GEOMETRY,
  'Habitats contains unreadable geometry'
)
