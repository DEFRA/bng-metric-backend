import Joi from 'joi'

export function parentFeatureIdField({ editableCreated = false } = {}) {
  const field = Joi.string().uuid()
  return {
    parentFeatureId: editableCreated
      ? field
          .allow(null)
          .description(
            'The linked baseline featureId from a BNG Service template parent_uuid, or preserved when a Created area or hedgerow reference is edited. An explicit null records that an edited Created feature has no identifiable baseline parent. Absent on untouched legacy rows and when an untouched BNG Service template row names no parent.'
          )
      : field.description(
          'The featureId of the baseline feature this post-intervention feature is linked to by its parent_uuid in a BNG Service template file, whatever its Retention Category. Absent when it names no parent, and on every feature of a legacy upload.'
        )
  }
}
