import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn()
}))

const { S3Client } = await import('@aws-sdk/client-s3')
const { config } = await import('../../config.js')
const { createS3Client } = await import('./s3-client.js')

/**
 * Mocks config.get for keys used by createS3Client.
 * `aws.region` mirrors convict (env AWS_REGION at process start); null uses the eu-west-2 fallback in code.
 */
function mockConfig(overrides = {}) {
  const values = {
    cdpEnvironment: 'local',
    'aws.region': null,
    ...overrides
  }
  vi.mocked(config.get).mockImplementation((key) => values[key] ?? null)
}

beforeEach(() => {
  vi.spyOn(config, 'get')
})

describe('createS3Client in local environment', () => {
  const savedEndpoint = process.env.AWS_ENDPOINT_URL
  const savedAccessKeyId = process.env.AWS_ACCESS_KEY_ID
  const savedSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY

  beforeEach(() => {
    mockConfig({ cdpEnvironment: 'local' })
    delete process.env.AWS_ENDPOINT_URL
    delete process.env.AWS_ACCESS_KEY_ID
    delete process.env.AWS_SECRET_ACCESS_KEY
  })

  afterEach(() => {
    if (savedEndpoint === undefined) {
      delete process.env.AWS_ENDPOINT_URL
    } else {
      process.env.AWS_ENDPOINT_URL = savedEndpoint
    }
    if (savedAccessKeyId === undefined) {
      delete process.env.AWS_ACCESS_KEY_ID
    } else {
      process.env.AWS_ACCESS_KEY_ID = savedAccessKeyId
    }
    if (savedSecretAccessKey === undefined) {
      delete process.env.AWS_SECRET_ACCESS_KEY
    } else {
      process.env.AWS_SECRET_ACCESS_KEY = savedSecretAccessKey
    }
  })

  it('creates an S3Client pointing at the default localstack endpoint when AWS_ENDPOINT_URL is unset', () => {
    createS3Client()

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'eu-west-2',
        endpoint: 'http://localhost:4566', // NOSONAR: LocalStack uses HTTP intentionally in local dev
        forcePathStyle: true
      })
    )
  })

  it('uses AWS_ENDPOINT_URL from the environment when set', () => {
    process.env.AWS_ENDPOINT_URL = 'http://custom-localstack:4566' // NOSONAR: LocalStack uses HTTP intentionally in local dev

    createS3Client()

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'http://custom-localstack:4566' }) // NOSONAR: LocalStack uses HTTP intentionally in local dev
    )
  })

  it('uses aws.region from config when set', () => {
    mockConfig({ cdpEnvironment: 'local', 'aws.region': 'us-east-1' })

    createS3Client()

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'us-east-1' })
    )
  })

  it('uses LocalStack dummy credentials when AWS_ACCESS_KEY_ID is unset', () => {
    createS3Client()

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: {
          accessKeyId: 'test',
          secretAccessKey: 'test'
        }
      })
    )
  })

  it('uses AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from the environment when set', () => {
    process.env.AWS_ACCESS_KEY_ID = 'my-key'
    process.env.AWS_SECRET_ACCESS_KEY = 'my-secret'

    createS3Client()

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: {
          accessKeyId: 'my-key',
          secretAccessKey: 'my-secret'
        }
      })
    )
  })
})

describe('createS3Client in a non-local environment', () => {
  beforeEach(() => {
    mockConfig({ cdpEnvironment: 'dev' })
  })

  it('passes region eu-west-2 from config when aws.region is unset', () => {
    createS3Client()

    expect(S3Client).toHaveBeenCalledWith({ region: 'eu-west-2' })
  })

  it('uses aws.region from config when set', () => {
    mockConfig({ cdpEnvironment: 'dev', 'aws.region': 'eu-west-1' })

    createS3Client()

    expect(S3Client).toHaveBeenCalledWith({ region: 'eu-west-1' })
  })

  it('does not set a localstack endpoint or forcePathStyle', () => {
    createS3Client()

    expect(S3Client).not.toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: expect.anything() })
    )
    expect(S3Client).not.toHaveBeenCalledWith(
      expect.objectContaining({ forcePathStyle: true })
    )
  })
})
