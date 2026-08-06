// A minimal stand-in for Hapi's response toolkit `h`. It lets the async
// validation worker run the existing request handlers (runFullValidation /
// saveBaselineForProject) off a live request and capture what they would have
// sent, so the outcome can be persisted to the job row. Mirrors the makeH() test
// double in src/routes/baseline.test-fixtures.js, but records the values.
function createResponseCapture() {
  const captured = { payload: undefined, statusCode: undefined }
  const h = {
    response(payload) {
      captured.payload = payload
      return h
    },
    code(statusCode) {
      captured.statusCode = statusCode
      return h
    }
  }
  return { h, captured }
}

export { createResponseCapture }
