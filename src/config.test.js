import { describe, test, expect, vi } from 'vitest'

describe('#config', () => {
  test('Should default to non-production settings', async () => {
    const { config } = await import('./config.js')

    expect(config.get('log.format')).toBe('pino-pretty')
    expect(config.get('log.redact')).toEqual(['req', 'res', 'responseTime'])
    expect(config.get('isMetricsEnabled')).toBe(false)
    expect(config.get('postgres.iamAuthentication')).toBe(false)
  })

  test('Should default to production settings when NODE_ENV is production', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    vi.resetModules()

    const { config } = await import('./config.js')

    expect(config.get('log.format')).toBe('ecs')
    expect(config.get('log.redact')).toEqual([
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers'
    ])
    expect(config.get('isMetricsEnabled')).toBe(true)
    expect(config.get('postgres.iamAuthentication')).toBe(true)

    vi.unstubAllEnvs()
  })
})

describe('#config boolean flags from the environment', () => {
  const reload = async () => {
    vi.resetModules()
    const { config } = await import('./config.js')
    return config
  }

  test.each([
    ['true', true],
    ['1', true],
    ['yes', true],
    ['on', true],
    ['false', false],
    ['0', false],
    ['no', false],
    ['off', false],
    ['FALSE', false],
    ['  false  ', false]
  ])('Should read ENABLE_METRICS=%s as %s', async (value, expected) => {
    vi.stubEnv('ENABLE_METRICS', value)

    const config = await reload()

    expect(config.get('isMetricsEnabled')).toBe(expected)

    vi.unstubAllEnvs()
  })

  test('Should reject a value that is not recognisably a boolean', async () => {
    vi.stubEnv('ENABLE_METRICS', 'banana')

    await expect(reload()).rejects.toThrow(/must be one of true\/false/)

    vi.unstubAllEnvs()
  })
})

describe('#config service-template flag', () => {
  const reload = async () => {
    vi.resetModules()
    const { config } = await import('./config.js')
    return config
  }

  test('Should default to off, so every environment takes the legacy template until it is set', async () => {
    vi.stubEnv('SERVICE_TEMPLATE_ENABLED', undefined)

    const config = await reload()

    expect(config.get('serviceTemplate.enabled')).toBe(false)

    vi.unstubAllEnvs()
  })

  test.each([
    ['true', true],
    ['on', true],
    ['1', true],
    ['false', false],
    ['off', false],
    ['0', false]
  ])(
    'Should read SERVICE_TEMPLATE_ENABLED=%s as %s',
    async (value, expected) => {
      vi.stubEnv('SERVICE_TEMPLATE_ENABLED', value)

      const config = await reload()

      expect(config.get('serviceTemplate.enabled')).toBe(expected)

      vi.unstubAllEnvs()
    }
  )

  test('Should refuse a value that is not recognisably a boolean', async () => {
    vi.stubEnv('SERVICE_TEMPLATE_ENABLED', 'enabled')

    await expect(reload()).rejects.toThrow(/must be one of true\/false/)

    vi.unstubAllEnvs()
  })
})

describe('#config perf-evidence flag', () => {
  const reload = async () => {
    vi.resetModules()
    const { config } = await import('./config.js')
    return config
  }

  test('Should default to on so the spike gathers evidence everywhere', async () => {
    const config = await reload()

    expect(config.get('isPerfEvidenceEnabled')).toBe(true)
  })

  test.each([
    ['false', false],
    ['0', false],
    ['off', false],
    ['true', true]
  ])('Should read ENABLE_PERF_EVIDENCE=%s as %s', async (value, expected) => {
    vi.stubEnv('ENABLE_PERF_EVIDENCE', value)

    const config = await reload()

    expect(config.get('isPerfEvidenceEnabled')).toBe(expected)

    vi.unstubAllEnvs()
  })
})
