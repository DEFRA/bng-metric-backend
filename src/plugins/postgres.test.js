import { postgres } from './postgres.js'

vi.mock('../common/helpers/logging/logger.js', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn()
  })
}))

const mockRelease = vi.fn()
const mockQuery = vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] })
const mockConnect = vi.fn().mockResolvedValue({
  query: mockQuery,
  release: mockRelease
})
const mockEventHandlers = {}

vi.mock('pg-pool', () => {
  return {
    default: vi.fn().mockImplementation(function () {
      this.on = (event, handler) => {
        mockEventHandlers[event] = handler
      }
      this.connect = mockConnect
    })
  }
})

vi.mock('@aws-sdk/rds-signer', () => ({
  Signer: vi.fn().mockImplementation(function () {
    this.getAuthToken = vi.fn().mockResolvedValue('mock-iam-token')
  })
}))

vi.mock('@aws-sdk/credential-providers', () => ({
  fromNodeProviderChain: vi.fn().mockReturnValue('mock-credentials')
}))

describe('#postgres plugin', () => {
  const mockServer = {
    logger: { info: vi.fn(), error: vi.fn() },
    decorate: vi.fn(),
    secureContext: null
  }

  const baseOptions = {
    host: 'localhost',
    port: 5432,
    user: 'dev',
    database: 'bng',
    localPassword: 'dev',
    region: 'eu-west-2'
  }

  beforeEach(() => {
    mockServer.decorate.mockReset()
    mockServer.logger.info.mockReset()
    mockServer.logger.error.mockReset()
    mockConnect.mockClear()
    mockQuery.mockClear()
    mockRelease.mockClear()
  })

  test('Should use local password when iamAuthentication is false', async () => {
    const Pool = (await import('pg-pool')).default
    let passwordFn

    Pool.mockImplementation(function (opts) {
      passwordFn = opts.password
      this.on = (event, handler) => {
        mockEventHandlers[event] = handler
      }
      this.connect = mockConnect
    })

    await postgres.plugin.register(mockServer, {
      ...baseOptions,
      iamAuthentication: false
    })

    expect(mockServer.decorate).toHaveBeenCalledWith(
      'server',
      'pg',
      expect.anything()
    )
    expect(mockServer.decorate).toHaveBeenCalledWith(
      'request',
      'pg',
      expect.anything()
    )
    expect(passwordFn()).toBe('dev')
  })

  test('Should verify connectivity at startup', async () => {
    await postgres.plugin.register(mockServer, {
      ...baseOptions,
      iamAuthentication: false
    })

    expect(mockConnect).toHaveBeenCalled()
    expect(mockQuery).toHaveBeenCalledWith('SELECT 1 AS ok')
    expect(mockRelease).toHaveBeenCalled()
  })

  test('Should throw if startup connection fails', async () => {
    mockConnect.mockRejectedValueOnce(new Error('connection refused'))

    await expect(
      postgres.plugin.register(mockServer, {
        ...baseOptions,
        iamAuthentication: false
      })
    ).rejects.toThrow('connection refused')

    expect(mockServer.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('connection refused')
    )
  })

  test('Should log pool errors', async () => {
    await postgres.plugin.register(mockServer, {
      ...baseOptions,
      iamAuthentication: false
    })

    const { createLogger } = await import('../common/helpers/logging/logger.js')
    const logger = createLogger()

    mockEventHandlers.error(new Error('pool error'))
    expect(logger.error).toHaveBeenCalledWith('Postgres pool error: pool error')
  })

  test('Should return IAM token when iamAuthentication is true', async () => {
    const { Signer } = await import('@aws-sdk/rds-signer')

    const Pool = (await import('pg-pool')).default
    let passwordFn

    Pool.mockImplementation(function (opts) {
      passwordFn = opts.password
      this.on = (event, handler) => {
        mockEventHandlers[event] = handler
      }
      this.connect = mockConnect
    })

    await postgres.plugin.register(mockServer, {
      ...baseOptions,
      iamAuthentication: true
    })

    const token = await passwordFn()

    expect(Signer).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: 'localhost',
        port: 5432,
        username: 'dev'
      })
    )
    expect(token).toBe('mock-iam-token')
  })

  test('Should log and rethrow when IAM token request fails', async () => {
    const { Signer } = await import('@aws-sdk/rds-signer')

    Signer.mockImplementation(function () {
      this.getAuthToken = vi
        .fn()
        .mockRejectedValue(new Error('credentials expired'))
    })

    const Pool = (await import('pg-pool')).default
    let passwordFn

    Pool.mockImplementation(function (opts) {
      passwordFn = opts.password
      this.on = () => {}
      this.connect = mockConnect
    })

    await postgres.plugin.register(mockServer, {
      ...baseOptions,
      iamAuthentication: true
    })

    const { createLogger } = await import('../common/helpers/logging/logger.js')
    const logger = createLogger()

    await expect(passwordFn()).rejects.toThrow('credentials expired')
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to obtain IAM RDS token: credentials expired'
    )
  })
})
