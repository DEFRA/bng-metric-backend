import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn()
}))

const { S3Client } = await import('@aws-sdk/client-s3')
const { config } = await import('../../config.js')
const { createS3Client } = await import('./s3-client.js')

/** Keys read by {@link createS3Client} */
function mockConfig(overrides = {}) {
  const values = {
    'aws.region': 'eu-west-2',
    's3.endpoint': null,
    's3.forcePathStyle': false,
    ...overrides
  }
  vi.mocked(config.get).mockImplementation((key) => values[key] ?? null)
}

beforeEach(() => {
  vi.spyOn(config, 'get')
  vi.mocked(S3Client).mockClear()
})

describe('createS3Client', () => {
  it('adds endpoint and path-style when s3.endpoint is set (LocalStack / dev)', () => {
    mockConfig({
      'aws.region': 'eu-west-2',
      's3.endpoint': 'http://localhost:4566', // NOSONAR: LocalStack uses HTTP in local dev
      's3.forcePathStyle': true
    })

    createS3Client()

    expect(S3Client).toHaveBeenCalledWith({
      region: 'eu-west-2',
      endpoint: 'http://localhost:4566', // NOSONAR: LocalStack uses HTTP in local dev
      forcePathStyle: true
    })
  })

  it('uses aws.region from config when set', () => {
    mockConfig({
      'aws.region': 'us-east-1',
      's3.endpoint': 'http://localhost:4566', // NOSONAR: LocalStack uses HTTP in local dev
      's3.forcePathStyle': true
    })

    createS3Client()

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'us-east-1' })
    )
  })

  it('uses a custom s3.endpoint from config', () => {
    mockConfig({
      's3.endpoint': 'http://custom-localstack:4566', // NOSONAR: LocalStack uses HTTP in local dev
      's3.forcePathStyle': true
    })

    createS3Client()

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'http://custom-localstack:4566' }) // NOSONAR: LocalStack uses HTTP in local dev
    )
  })

  it('omits endpoint and forcePathStyle when s3.endpoint is unset (e.g. CDP)', () => {
    mockConfig({
      'aws.region': 'eu-west-2',
      's3.endpoint': null,
      's3.forcePathStyle': false
    })

    createS3Client()

    expect(S3Client).toHaveBeenCalledWith({ region: 'eu-west-2' })
  })

  it('does not pass explicit credentials (SDK default provider chain)', () => {
    mockConfig({
      's3.endpoint': 'http://localhost:4566', // NOSONAR: LocalStack uses HTTP in local dev
      's3.forcePathStyle': true
    })

    createS3Client()

    expect(S3Client.mock.calls[0][0]).not.toHaveProperty('credentials')
  })
})
