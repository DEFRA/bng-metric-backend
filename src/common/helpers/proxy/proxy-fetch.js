import { fetch as undiciFetch, ProxyAgent } from 'undici'

import { config } from '../../../config.js'

// Idle sockets are closed after 10s, and never held open longer than 30s even
// if the server's Keep-Alive header asks for more.
const KEEP_ALIVE_TIMEOUT_MS = 10_000
const KEEP_ALIVE_MAX_TIMEOUT_MS = 30_000

let cachedAgent
let cachedProxyUri

/**
 * One ProxyAgent per proxy URI, reused across requests. If the URI changes the
 * superseded agent is closed so its sockets are not leaked.
 *
 * `allowH2: false` keeps the tunnelled connection on HTTP/1.1. The same agent is
 * installed as the global dispatcher (see setup-proxy.js), where Node's bundled
 * fetch reaches it through undici's legacy Dispatcher1 wrapper; since undici
 * 8.11.0 that wrapper no longer forces HTTP/1.1, and an HTTP/2 response comes
 * back with its headers dropped (no content-type, body still gzipped).
 * @param {string} proxyUri
 * @returns {ProxyAgent}
 */
export function getProxyAgent(proxyUri) {
  if (cachedAgent && cachedProxyUri === proxyUri) {
    return cachedAgent
  }

  const superseded = cachedAgent

  cachedAgent = new ProxyAgent({
    uri: proxyUri,
    allowH2: false,
    keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
    keepAliveMaxTimeout: KEEP_ALIVE_MAX_TIMEOUT_MS
  })
  cachedProxyUri = proxyUri

  if (superseded) {
    superseded.close().catch(() => {})
  }

  return cachedAgent
}

/**
 * Drop-in replacement for `fetch` that honours HTTP_PROXY.
 *
 * With a proxy configured, the request is made with undici's own `fetch` and a
 * ProxyAgent from the same package. Passing an npm-undici ProxyAgent to Node's
 * global `fetch` mixes two undici implementations (Node bundles its own), which
 * is what broke OIDC discovery in CDP. Without a proxy the request goes direct
 * through the global `fetch`, unchanged.
 * @param {string | URL | Request} resource
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
export function proxyFetch(resource, options) {
  const proxyUri = config.get('httpProxy')

  if (!proxyUri) {
    return globalThis.fetch(resource, options)
  }

  return undiciFetch(resource, {
    ...options,
    dispatcher: getProxyAgent(proxyUri)
  })
}
