import { HTTP_STATUS } from '../../common/helpers/http/status-codes.js'

/**
 * A stand-in for Hapi's response toolkit, so the shared pipeline can run
 * outside a request.
 *
 * The pipeline builds its answer by calling `h.response(payload)` and
 * occasionally `.code(status)`. A background job has no toolkit, but rather
 * than fork the pipeline for the async path — which would let the two drift —
 * this captures the same calls and hands back what was said. The job stores
 * that payload verbatim, so a polling client sees exactly the body the
 * synchronous route would have returned.
 *
 * @returns {{ toolkit: object, captured: { statusCode: number, payload: unknown } }}
 */
function createResponseCollector() {
  const captured = { statusCode: HTTP_STATUS.OK, payload: null }

  const toolkit = {
    response(payload) {
      captured.payload = payload
      captured.statusCode = HTTP_STATUS.OK
      return {
        code(statusCode) {
          captured.statusCode = statusCode
          return this
        }
      }
    }
  }

  return { toolkit, captured }
}

export { createResponseCollector }
