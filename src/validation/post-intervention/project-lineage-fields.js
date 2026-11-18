import Joi from 'joi'
import { BNG_SERVICE_ONLY } from '../template-applicability.js'

export function parentFeatureIdField({ editableCreated = false } = {}) {
  const field = Joi.string().uuid()
  return {
    parentFeatureId: editableCreated
      ? field
          .allow(null)
          .description(
            'The linked baseline featureId from a BNG Service template parent_uuid, or preserved when a Created area, tree, hedgerow or watercourse reference, or an Enhanced tree, area habitat or hedgerow reference, is edited. An explicit null records that an edited feature has no identifiable baseline parent. Absent on untouched legacy rows and when an untouched BNG Service template row names no parent.'
          )
      : field
          .description(
            'The featureId of the baseline feature this post-intervention feature is linked to by its parent_uuid in a BNG Service template file, whatever its Retention Category. Absent when it names no parent, and on every feature of a legacy upload.'
          )
          .meta(BNG_SERVICE_ONLY)
  }
}

/**
 * A post-intervention feature's `parent_uuid` from a BNG Service template
 * file (template-ids.js): the file's own id for the baseline feature it was
 * copied from, which `parentFeatureId` resolves to the service's.
 */
export function parentUuidField() {
  return {
    parentUuid: Joi.string()
      .uuid()
      .allow(null)
      .description(
        "The parent_uuid a BNG Service template file gives this post-intervention feature: the feature_uuid of the baseline feature it was copied from, the file's own id for it, which parentFeatureId resolves to the service's featureId. It traces the feature back to the ecologist's QGIS file. Null when the row names no parent. Absent on a legacy upload, whose template has no such column."
      )
      .meta(BNG_SERVICE_ONLY)
  }
}
