import { POST_INTERVENTION } from 'bng-library/bng-service'

import { withGpkgFileDatabase } from '../geopackage.js'
import { templateForVersion } from './supported-versions.js'

/**
 * Whether any of a BNG Service template file's Post-Intervention tables holds
 * a feature.
 *
 * Every Post-Intervention table of the version counts, including those the
 * service does not read yet (vertical area habitats, individual trees): a file
 * with features in any of them describes a post-intervention stage. The format
 * gate has already checked the file against its version, so every table is
 * there to count. A file that cannot be opened counts as having features, and
 * the reads that follow report it.
 *
 * @param {string} filePath
 * @param {string} version a template version the service reads
 * @returns {boolean}
 */
export function hasPostInterventionFeatures(filePath, version) {
  const tables = templateForVersion(version)
    .schema.layers.map((layer) => layer.tableName)
    .filter((table) => table.endsWith(` ${POST_INTERVENTION}`))
  const result = withGpkgFileDatabase(filePath, (db) =>
    tables.some((table) =>
      db.prepare(`SELECT 1 FROM "${table.replaceAll('"', '""')}" LIMIT 1`).get()
    )
  )
  return result !== false
}
