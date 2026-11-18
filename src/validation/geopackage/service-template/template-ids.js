import { FEATURE_UUID, PARENT_UUID } from 'bng-library/bng-service'

import { text } from './lineage/lineage-rows.js'

// The ids a BNG Service template file gives its features, as named fields of
// the project document, so a stored feature can be traced back to
// the ecologist's QGIS file. They are not the service's own ids: a feature's
// `featureId` is the service's, and a post-intervention feature's
// `parentFeatureId` is its parent's `featureId` (link-parents.js). A legacy
// file has no such columns, so its features gain neither field. Each id is
// read as the lineage stage reads it (lineage-rows.js `text`), so a stored id
// always matches the one the link was made by.

/** A field from a column the file has, or nothing to spread when it has none. */
const fieldFrom = (props, column, key) =>
  Object.hasOwn(props ?? {}, column) ? { [key]: text(props[column]) } : {}

/**
 * `{ featureUuid }`: a baseline feature's `feature_uuid`, the id the file's
 * post-intervention rows name it by. Null when the file leaves it blank.
 *
 * @param {object} props a feature's attributes, as the pipeline reads them
 * @returns {{ featureUuid?: string | null }}
 */
export const featureUuidField = (props) =>
  fieldFrom(props, FEATURE_UUID, 'featureUuid')

/**
 * `{ parentUuid }`: a post-intervention feature's `parent_uuid`, the
 * `feature_uuid` of the baseline feature it was copied from. Null when it
 * names no parent.
 *
 * @param {object} props a feature's attributes, as the pipeline reads them
 * @returns {{ parentUuid?: string | null }}
 */
export const parentUuidField = (props) =>
  fieldFrom(props, PARENT_UUID, 'parentUuid')
