import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('./s3-client.js')

const {
  downloadFileToPath,
  S3FileTooLargeError,
  S3TimeoutError,
  S3ConnectionError,
  DEFAULT_TIMEOUT_MS,
  MAX_FILE_SIZE_BYTES
} = await import('./download-file.js')
const { createS3Client } = await import('./s3-client.js')

const BUCKET = 'baseline-files'
const KEY = 'baseline/file.gpkg'

let downloadDir
let nextDestId = 0

beforeAll(() => {
  downloadDir = mkdtempSync(join(tmpdir(), 's3-download-'))
})

afterAll(() => {
  rmSync(downloadDir, { recursive: true, force: true })
})

/** A fresh destination path per call, so tests never observe each other's file. */
function destPath() {
  nextDestId += 1
  return join(downloadDir, `download-${nextDestId}.bin`)
}

/** Build an async-iterable body from an array of Buffer chunks. */
function makeBody(chunks) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) {
        yield chunk
      }
    }
  }
}

/** Build an Error with the given name (simulates DOMException timeout/abort). */
function namedError(name, message = name) {
  const err = new Error(message)
  err.name = name
  return err
}

async function* failWithTimeout() {
  yield Buffer.from('partial')
  throw namedError('TimeoutError')
}

async function* failWithAbort() {
  yield Buffer.from('partial')
  throw namedError('AbortError')
}

async function* failWithError() {
  yield Buffer.from('partial')
  throw new Error('socket hang up')
}

function mockSendWith(result) {
  const send = vi.fn().mockResolvedValue(result)
  vi.mocked(createS3Client).mockReturnValue({ send })
  return send
}

function mockSendRejecting(error) {
  const send = vi.fn().mockRejectedValue(error)
  vi.mocked(createS3Client).mockReturnValue({ send })
  return send
}

const THIRTY_SECONDS_MS = 30_000
const ONE_HUNDRED_MB = 100 * 1024 * 1024

describe('DEFAULT_TIMEOUT_MS', () => {
  it('is 30 seconds', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(THIRTY_SECONDS_MS)
  })
})

describe('MAX_FILE_SIZE_BYTES', () => {
  it('is 100 MB', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(ONE_HUNDRED_MB)
  })
})

describe('downloadFileToPath successful download', () => {
  it('streams the body to the destination file', async () => {
    mockSendWith({
      Body: makeBody([Buffer.from('hello '), Buffer.from('world')])
    })
    const dest = destPath()

    const result = await downloadFileToPath(BUCKET, KEY, dest)

    expect(readFileSync(dest).toString()).toBe('hello world')
    expect(result).toEqual({ bytes: 'hello world'.length })
  })

  it('writes an empty file when the body has no chunks', async () => {
    mockSendWith({ Body: makeBody([]) })
    const dest = destPath()

    const result = await downloadFileToPath(BUCKET, KEY, dest)

    expect(readFileSync(dest).byteLength).toBe(0)
    expect(result).toEqual({ bytes: 0 })
  })

  it('never returns the object contents in memory', async () => {
    mockSendWith({ Body: makeBody([Buffer.from('ok')]) })

    const result = await downloadFileToPath(BUCKET, KEY, destPath())

    expect(Buffer.isBuffer(result)).toBe(false)
    expect(Object.keys(result)).toEqual(['bytes'])
  })

  it('passes the abortSignal through to client.send', async () => {
    const send = mockSendWith({ Body: makeBody([Buffer.from('ok')]) })

    await downloadFileToPath(BUCKET, KEY, destPath())

    const [, options] = send.mock.calls[0]
    expect(options).toHaveProperty('abortSignal')
  })
})

describe('downloadFileToPath when client.send throws a timeout', () => {
  it('throws S3TimeoutError for a TimeoutError', async () => {
    mockSendRejecting(namedError('TimeoutError'))

    await expect(downloadFileToPath(BUCKET, KEY, destPath())).rejects.toThrow(
      S3TimeoutError
    )
  })

  it('throws S3TimeoutError for an AbortError', async () => {
    mockSendRejecting(namedError('AbortError'))

    await expect(downloadFileToPath(BUCKET, KEY, destPath())).rejects.toThrow(
      S3TimeoutError
    )
  })

  it('includes bucket and key in the S3TimeoutError message', async () => {
    mockSendRejecting(namedError('TimeoutError'))

    await expect(downloadFileToPath(BUCKET, KEY, destPath())).rejects.toThrow(
      new RegExp(`${BUCKET}.*${KEY}|${KEY}.*${BUCKET}`)
    )
  })

  it('writes no destination file at all', async () => {
    mockSendRejecting(namedError('TimeoutError'))
    const dest = destPath()

    await expect(downloadFileToPath(BUCKET, KEY, dest)).rejects.toThrow()

    expect(existsSync(dest)).toBe(false)
  })
})

describe('downloadFileToPath when client.send throws a connection error', () => {
  it('throws S3ConnectionError for a generic error', async () => {
    mockSendRejecting(new Error('ECONNREFUSED'))

    await expect(downloadFileToPath(BUCKET, KEY, destPath())).rejects.toThrow(
      S3ConnectionError
    )
  })

  it('includes the original message in the S3ConnectionError', async () => {
    mockSendRejecting(new Error('NoSuchKey'))

    await expect(downloadFileToPath(BUCKET, KEY, destPath())).rejects.toThrow(
      /NoSuchKey/
    )
  })
})

describe('downloadFileToPath when the body stream fails part-way', () => {
  it('throws S3TimeoutError for a TimeoutError during streaming', async () => {
    mockSendWith({ Body: { [Symbol.asyncIterator]: failWithTimeout } })

    await expect(downloadFileToPath(BUCKET, KEY, destPath())).rejects.toThrow(
      S3TimeoutError
    )
  })

  it('throws S3TimeoutError for an AbortError during streaming', async () => {
    mockSendWith({ Body: { [Symbol.asyncIterator]: failWithAbort } })

    await expect(downloadFileToPath(BUCKET, KEY, destPath())).rejects.toThrow(
      S3TimeoutError
    )
  })

  it('throws S3ConnectionError for a generic stream error', async () => {
    mockSendWith({ Body: { [Symbol.asyncIterator]: failWithError } })

    await expect(downloadFileToPath(BUCKET, KEY, destPath())).rejects.toThrow(
      S3ConnectionError
    )
  })

  it('includes the original message in the S3ConnectionError', async () => {
    mockSendWith({ Body: { [Symbol.asyncIterator]: failWithError } })

    await expect(downloadFileToPath(BUCKET, KEY, destPath())).rejects.toThrow(
      /socket hang up/
    )
  })

  it('removes the partial file, so no caller can open a truncated GeoPackage', async () => {
    mockSendWith({ Body: { [Symbol.asyncIterator]: failWithError } })
    const dest = destPath()

    await expect(downloadFileToPath(BUCKET, KEY, dest)).rejects.toThrow()

    expect(existsSync(dest)).toBe(false)
  })
})

describe('downloadFileToPath when the S3 object exceeds MAX_FILE_SIZE_BYTES', () => {
  it('throws S3FileTooLargeError when Content-Length exceeds the limit', async () => {
    mockSendWith({
      Body: makeBody([]),
      ContentLength: MAX_FILE_SIZE_BYTES + 1
    })

    await expect(downloadFileToPath(BUCKET, KEY, destPath())).rejects.toThrow(
      S3FileTooLargeError
    )
  })

  it('includes bucket, key and sizes in the error message', async () => {
    mockSendWith({
      Body: makeBody([]),
      ContentLength: MAX_FILE_SIZE_BYTES + 1
    })

    await expect(downloadFileToPath(BUCKET, KEY, destPath())).rejects.toThrow(
      new RegExp(`${BUCKET}.*${KEY}|${KEY}.*${BUCKET}`)
    )
  })

  it('rejects before a byte is written', async () => {
    mockSendWith({
      Body: makeBody([Buffer.from('should never be written')]),
      ContentLength: MAX_FILE_SIZE_BYTES + 1
    })
    const dest = destPath()

    await expect(downloadFileToPath(BUCKET, KEY, dest)).rejects.toThrow()

    expect(existsSync(dest)).toBe(false)
  })

  it('does not throw when Content-Length equals MAX_FILE_SIZE_BYTES', async () => {
    mockSendWith({
      Body: makeBody([Buffer.alloc(1)]),
      ContentLength: MAX_FILE_SIZE_BYTES
    })

    await expect(downloadFileToPath(BUCKET, KEY, destPath())).resolves.toEqual({
      bytes: 1
    })
  })

  it('does not throw when Content-Length is absent', async () => {
    mockSendWith({ Body: makeBody([Buffer.from('ok')]) })

    await expect(downloadFileToPath(BUCKET, KEY, destPath())).resolves.toEqual({
      bytes: 2
    })
  })
})

describe('downloadFileToPath custom timeoutMs option', () => {
  it('accepts a custom timeout and still succeeds', async () => {
    mockSendWith({ Body: makeBody([Buffer.from('data')]) })
    const dest = destPath()

    await downloadFileToPath(BUCKET, KEY, dest, { timeoutMs: 5_000 })

    expect(readFileSync(dest).toString()).toBe('data')
  })
})
