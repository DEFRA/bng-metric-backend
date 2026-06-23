/**
 * Joi sub-schemas shared between project.js (baseline) and
 * project-post-intervention-schema.js (post-intervention).
 *
 * Extracted here to avoid circular imports between the two schema files.
 */
import Joi from 'joi'

import { MAX_FILE_SIZE_BYTES } from '../services/s3/download-file.js'

export const MAX_FILENAME_LENGTH = 255

// Whitelist-only approach addresses six classes of attack in one rule:
//   1. Extension spoofing  — bidi overrides (U+202E etc.) not in [a-zA-Z0-9 ._-]
//   2. Path traversal      — / and leading dots excluded; .. sequences impossible
//   3. Log injection       — \n, \r and other control chars not in the set
//   4. Wrong extension     — \.gpkg$ is mandatory (case-insensitive)
//   5. Invisible chars      — zero-width / formatting codepoints not in the set
//   6. SQL injection       — ' " ; not in the set; lone - cannot form --
export const SAFE_FILENAME_RE = /^[a-z0-9][a-z0-9 ._-]*\.gpkg$/i

export const habitatSizesSummarySchema = Joi.object({
  areaHabitats: Joi.object({
    totalSquareMetres: Joi.number()
      .required()
      .description('Total area of all habitat parcels, in square metres.')
  }).required(),
  hedgerows: Joi.object({
    totalMetres: Joi.number()
      .required()
      .description('Total length of all hedgerows, in metres.')
  }).required(),
  watercourses: Joi.object({
    totalMetres: Joi.number()
      .required()
      .description('Total length of all watercourses, in metres.')
  }).required()
})
  .allow(null)
  .description(
    'Total feature sizes by module, measured from geometry in PostGIS. Null until a baseline is imported.'
  )

export const baselineUnitsTotalsSchema = Joi.object({
  totalUnits: Joi.number()
    .required()
    .description('Sum of habitat, hedgerow and watercourse baseline units.'),
  habitatsTotal: Joi.number()
    .required()
    .description('Sum of baseline units across all area habitats.'),
  hedgerowsTotal: Joi.number()
    .required()
    .description('Sum of baseline units across all hedgerows.'),
  watercoursesTotal: Joi.number()
    .required()
    .description('Sum of baseline units across all watercourses.')
}).description('Baseline biodiversity unit totals, summed across features.')

export const redLineSchema = Joi.object({
  featureId: Joi.string()
    .uuid()
    .required()
    .description(
      'UUID assigned on import; join key to the bng.baseline_red_line geometry row.'
    ),
  siteName: Joi.string()
    .allow(null, '')
    .description('Site name from the GeoPackage Red Line Boundary layer.'),
  area: Joi.number()
    .allow(null)
    .description(
      'Site area as recorded in the GeoPackage Red Line Boundary layer (Area column).'
    ),
  properties: Joi.object()
    .unknown(true)
    .description(
      'Raw attribute columns copied verbatim from the GeoPackage Red Line Boundary layer.'
    )
})
  .allow(null)
  .description(
    'Red Line Boundary feature defining the site extent. Null until a baseline is imported.'
  )

export const featureDataEnvelopeFields = {
  uploadId: Joi.string()
    .uuid()
    .allow(null)
    .description(
      'CDP Uploader upload ID for the source GeoPackage. Null until a baseline is imported.'
    ),
  filename: Joi.string()
    .max(MAX_FILENAME_LENGTH)
    .pattern(SAFE_FILENAME_RE)
    .allow(null)
    .description(
      'Original filename of the uploaded GeoPackage. Constrained to a safe `*.gpkg` pattern.'
    ),
  fileSize: Joi.number()
    .integer()
    .min(0)
    .max(MAX_FILE_SIZE_BYTES)
    .allow(null)
    .description('Size of the uploaded GeoPackage, in bytes.'),
  importedAt: Joi.string()
    .isoDate()
    .description('ISO 8601 timestamp of when the data was imported.')
}
