import Joi from 'joi'

export function parentFeatureIdField({ editableCreated = false } = {}) {
  const field = Joi.string().uuid()
  return {
    parentFeatureId: editableCreated
      ? field
          .allow(null)
          .description(
            'The linked baseline featureId from a BNG Service template parent_uuid, or preserved when a Created habitat reference is edited. An explicit null records that an edited Created habitat has no identifiable baseline parent; absent on untouched legacy rows.'
          )
      : field.description(
          'The featureId of the baseline feature this post-intervention feature is linked to by its parent_uuid in a BNG Service template file, whatever its Retention Category. Absent when it names no parent, and on every feature of a legacy upload.'
        )
  }
}
