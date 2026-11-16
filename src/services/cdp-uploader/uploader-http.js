import Boom from '@hapi/boom'
import Wreck from '@hapi/wreck'

/** Wreck's code for a body that did not arrive in time (Boom.clientTimeout). */
const BODY_TIMEOUT_STATUS = 408
const FIRST_ERROR_STATUS = 400

/**
 * Send one request to the CDP Uploader and read its JSON body, with ONE
 * deadline for the whole exchange.
 *
 * Wreck's shortcuts (Wreck.get, Wreck.post) give `timeout` to the wait for the
 * response headers and then again, in full, to the read of the body. An
 * uploader that sends headers and then stalls could hold one call for twice
 * the timeout, which is the frontend's whole 10s at the default. Here the body
 * gets only the time left, and either timeout is a 504 "Client request
 * timeout". A 4xx or 5xx answer throws as the shortcuts do, with the parsed
 * body on `data.payload`.
 *
 * @param {'GET'|'POST'} method
 * @param {string} url
 * @param {{ timeoutMs: number, payload?: string, headers?: object }} options
 * @returns {Promise<{ res: import('node:http').IncomingMessage, payload: any }>}
 */
async function requestJson(method, url, { timeoutMs, ...options }) {
  const deadline = Date.now() + timeoutMs
  const res = await Wreck.request(method, url, {
    ...options,
    timeout: timeoutMs
  })

  let payload
  try {
    payload = await Wreck.read(res, {
      json: true,
      timeout: Math.max(1, deadline - Date.now())
    })
  } catch (err) {
    res.destroy?.()
    if (err?.output?.statusCode === BODY_TIMEOUT_STATUS) {
      throw Boom.gatewayTimeout('Client request timeout')
    }
    throw err
  }

  if (res.statusCode >= FIRST_ERROR_STATUS) {
    throw new Boom.Boom(
      `Response Error: ${res.statusCode} ${res.statusMessage}`,
      {
        statusCode: res.statusCode,
        data: { isResponseError: true, headers: res.headers, res, payload }
      }
    )
  }

  return { res, payload }
}

/**
 * @param {string} url
 * @param {number} timeoutMs the whole call, headers and body together
 */
export function uploaderGet(url, timeoutMs) {
  return requestJson('GET', url, { timeoutMs })
}

/**
 * @param {string} url
 * @param {{ payload: string, headers?: object }} options
 * @param {number} timeoutMs the whole call, headers and body together
 */
export function uploaderPost(url, options, timeoutMs) {
  return requestJson('POST', url, { ...options, timeoutMs })
}
