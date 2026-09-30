import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi
} from 'vitest'
import http from 'node:http'
import net from 'node:net'

import { getGlobalDispatcher, ProxyAgent, setGlobalDispatcher } from 'undici'

import { getProxyAgent, proxyFetch } from './proxy-fetch.js'
import { config } from '../../../config.js'

const { mockLoggerDebug } = vi.hoisted(() => ({ mockLoggerDebug: vi.fn() }))

vi.mock('../logging/logger.js', () => ({
  createLogger: () => ({
    debug: mockLoggerDebug,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${server.address().port}`)
    )
  })
}

function close(server) {
  server.closeAllConnections?.()
  return new Promise((resolve) => server.close(resolve))
}

// A minimal forward proxy: absolute-URI requests for http:// targets and
// CONNECT tunnels, counting every request it carries.
function createProxy() {
  const proxy = http.createServer((req, res) => {
    proxy.hits++
    const target = new URL(req.url)
    const upstream = http.request(
      {
        host: target.hostname,
        port: target.port,
        path: target.pathname,
        method: req.method,
        headers: req.headers
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode, upstreamRes.headers)
        upstreamRes.pipe(res)
      }
    )
    req.pipe(upstream)
  })
  proxy.on('connect', (req, socket, head) => {
    proxy.hits++
    const [host, port] = req.url.split(':')
    const upstream = net.connect(Number(port), host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
  })
  proxy.hits = 0
  return proxy
}

describe('proxyFetch', () => {
  const origin = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end('{"ok":true}')
  })
  const proxy = createProxy()
  let originUrl
  let proxyUrl

  beforeAll(async () => {
    originUrl = await listen(origin)
    proxyUrl = await listen(proxy)
  })

  afterAll(async () => {
    config.set('httpProxy', null)
    await getProxyAgent('http://127.0.0.1:1').close()
    await Promise.all([close(origin), close(proxy)])
  })

  beforeEach(() => {
    proxy.hits = 0
  })

  afterEach(() => {
    config.set('httpProxy', null)
    vi.restoreAllMocks()
  })

  test('routes the request through the proxy when HTTP_PROXY is set', async () => {
    config.set('httpProxy', proxyUrl)

    const response = await proxyFetch(`${originUrl}/discovery`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toEqual({ ok: true })
    expect(proxy.hits).toBe(1)
  })

  test('makes a direct request through the global fetch when no proxy is set', async () => {
    // The global fetch is vitest-fetch-mock here (.vite/setup-files.js)
    const globalFetch = globalThis.fetch
    globalFetch.mockResponseOnce('{"ok":true}')

    const response = await proxyFetch(`${originUrl}/direct`, {
      method: 'GET'
    })

    expect(await response.json()).toEqual({ ok: true })
    expect(globalFetch).toHaveBeenCalledWith(`${originUrl}/direct`, {
      method: 'GET'
    })
    expect(proxy.hits).toBe(0)
  })
})

describe('getProxyAgent', () => {
  test('reuses one agent for the same proxy URI', () => {
    const first = getProxyAgent('http://proxy.example:3128')
    const second = getProxyAgent('http://proxy.example:3128')

    expect(first).toBeInstanceOf(ProxyAgent)
    expect(second).toBe(first)
  })

  test('replaces and closes the agent when the proxy URI changes', () => {
    const superseded = getProxyAgent('http://proxy-a.example:3128')
    const closeSpy = vi.spyOn(superseded, 'close')

    const replacement = getProxyAgent('http://proxy-b.example:3128')

    expect(replacement).not.toBe(superseded)
    expect(closeSpy).toHaveBeenCalled()
    expect(getProxyAgent('http://proxy-b.example:3128')).toBe(replacement)
  })

  test('hands the global dispatcher to the replacement before closing the superseded agent', () => {
    const original = getGlobalDispatcher()
    const superseded = getProxyAgent('http://proxy-c.example:3128')
    setGlobalDispatcher(superseded)

    try {
      const replacement = getProxyAgent('http://proxy-d.example:3128')

      expect(getGlobalDispatcher()).toBe(replacement)
    } finally {
      setGlobalDispatcher(original)
    }
  })

  test('logs, rather than throws, when closing the superseded agent fails', async () => {
    const superseded = getProxyAgent('http://proxy-e.example:3128')
    const failure = new Error('close failed')
    vi.spyOn(superseded, 'close').mockRejectedValue(failure)

    getProxyAgent('http://proxy-f.example:3128')

    await vi.waitFor(() =>
      expect(mockLoggerDebug).toHaveBeenCalledWith(
        failure,
        'Closing the superseded proxy agent failed'
      )
    )
  })
})
