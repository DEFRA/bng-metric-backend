import Joi from 'joi'

const validateBaseline = {
  method: 'POST',
  path: '/baseline/validate/{uploadId}',
  options: {
    validate: {
      params: Joi.object({
        uploadId: Joi.string().uuid().required()
      })
    }
  },
  handler: async (_request, h) => {
    // const { uploadId } = _request.params

    // TODO: BMD-361 — download .gpkg file from S3 via cdp-uploader,
    // validate it is a valid GeoPackage (SQLite with gpkg_contents table,
    // required layers: red line boundary, baseline habitat parcels),
    // and return validation errors if invalid.
    return h.response({ valid: true })
  }
}

export { validateBaseline }
