import { FORMAT_BNG_SERVICE, TEMPLATE_SOURCE } from 'bng-library/bng-service'

import { ERROR_CODES, makeError } from '../errors.js'

/**
 * The BNG Service template's version record: one row of the GeoPackage
 * metadata extension (gpkg_metadata), referenced to the whole GeoPackage, whose
 * standard URI marks it as Defra's and whose text is the JSON
 * {"format": "bng-service", "version": "1.0"}. The template's MAINTAINERS.md
 * describes it. It is read first, because it is what says which template, and
 * which version of it, a file is in.
 */

/** Marks a gpkg_metadata row as the template's version record. */
export const VERSION_RECORD_URI = TEMPLATE_SOURCE.metadataUri

/** The gpkg_metadata_reference scope that refers a record to the whole file. */
const GEOPACKAGE_SCOPE = 'geopackage'

const METADATA_TABLE = 'gpkg_metadata'
const METADATA_REFERENCE_TABLE = 'gpkg_metadata_reference'

function hasTable(db, name) {
  return Boolean(
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND lower(name) = ?"
      )
      .get(name)
  )
}

/**
 * Every version record in the file, each with whether it is referenced to the
 * whole GeoPackage. A file without the metadata extension has none.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Array<{ metadata: unknown, wholeFile: boolean }>}
 */
function versionRecords(db) {
  if (!hasTable(db, METADATA_TABLE)) {
    return []
  }
  const records = db
    .prepare(
      `SELECT id, metadata FROM ${METADATA_TABLE} WHERE md_standard_uri = ? ORDER BY id`
    )
    .all(VERSION_RECORD_URI)
  if (records.length === 0 || !hasTable(db, METADATA_REFERENCE_TABLE)) {
    return records.map(({ metadata }) => ({ metadata, wholeFile: false }))
  }
  const referencedToFile = db.prepare(
    `SELECT 1 FROM ${METADATA_REFERENCE_TABLE}
      WHERE md_file_id = ? AND lower(reference_scope) = ?`
  )
  return records.map(({ id, metadata }) => ({
    metadata,
    wholeFile: Boolean(referencedToFile.get(id, GEOPACKAGE_SCOPE))
  }))
}

/**
 * The format and version a record names, or null when it names neither
 * cleanly: not JSON, not an object, the wrong format, or no version.
 *
 * @param {unknown} metadata the record's gpkg_metadata.metadata text
 * @returns {{ format: string, version: string } | null}
 */
function parseRecord(metadata) {
  let parsed
  try {
    parsed = JSON.parse(String(metadata))
  } catch {
    return null
  }
  const isNamedVersion =
    parsed?.format === FORMAT_BNG_SERVICE &&
    typeof parsed.version === 'string' &&
    parsed.version.trim() !== ''
  return isNamedVersion
    ? { format: parsed.format, version: parsed.version }
    : null
}

/**
 * Read the template version record: exactly one, referenced to the whole file,
 * naming the bng-service format and a version.
 *
 * A file with no record is refused as having none. Telling a legacy file apart,
 * for a clearer message, is the caller's business: the record is what this
 * reads, and a legacy file simply has none.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{ format: string, version: string } | { missing: true } | { error: { code: string, message: string } }}
 */
export function readTemplateVersion(db) {
  const records = versionRecords(db)
  if (records.length === 0) {
    return { missing: true }
  }
  if (records.length > 1) {
    return {
      error: makeError(
        ERROR_CODES.TEMPLATE_VERSION_DUPLICATED,
        `The file has ${records.length} template version records, so its template version is unclear. It should have one.`
      )
    }
  }
  const [record] = records
  const named = record.wholeFile ? parseRecord(record.metadata) : null
  if (!named) {
    return {
      error: makeError(
        ERROR_CODES.TEMPLATE_VERSION_INVALID,
        "The file's template version record cannot be read, so its template version is unknown."
      )
    }
  }
  return named
}

/** The error for a file with no version record that is not a legacy file. */
export function missingVersionError() {
  return makeError(
    ERROR_CODES.TEMPLATE_VERSION_MISSING,
    'The file has no template version record, so it is not a BNG Service template file.'
  )
}
