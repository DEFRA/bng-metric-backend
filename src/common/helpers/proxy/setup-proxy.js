import { setGlobalDispatcher } from 'undici'
import { bootstrap } from 'global-agent'

import { createLogger } from '../logging/logger.js'
import { getProxyAgent } from './proxy-fetch.js'
import { config } from '../../../config.js'

const logger = createLogger()

/**
 * If HTTP_PROXY is set setupProxy() will enable it globally
 * for a number of http clients.
 * Our own server-side requests should use proxyFetch() (proxy-fetch.js), which
 * pairs undici's fetch with its ProxyAgent. The global dispatcher remains as a
 * safety net for third-party code that calls Node's global fetch.
 */
export function setupProxy() {
  const proxyUrl = config.get('httpProxy')

  if (proxyUrl) {
    logger.info('setting up global proxies')

    // Undici proxy, shared with proxyFetch()
    setGlobalDispatcher(getProxyAgent(proxyUrl))

    // global-agent (axios/request/and others)
    bootstrap()
    globalThis.GLOBAL_AGENT.HTTP_PROXY = proxyUrl
  }
}
