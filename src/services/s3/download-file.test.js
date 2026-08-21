import { vi, describe, it, expect } from 'vitest'
import { readFile, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'

vi.mock('./s3-client.js')

const {
  downloadFileToTemp,
  S3FileTooLargeError,
  S3TimeoutError,
  S3ConnectionError,
  DEFAULT_TIMEOUT_MS,
  MAX_FILE_SIZE_BYTES
} = await import('./download-file.js')
const { createS3Client } = await import('./s3-client.js')

const BUCKET = 'baseline-files'
const KEY = 'baseline/file.gpkg'
const TEMP_DIR_PREFIX = 's3-download-'

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

/** Temp directories this module has left behind in os.tmpdir(). */
async function downloadTempDirs() {
  const entries = await readdir(tmpdir())
  return entries.filter((name) => name.startsWith(TEMP_DIR_PREFIX))
}

/** Run `fn` and assert it left no temp directory behind. */
async function expectingNoTempDirsLeft(fn) {
  const before = await downloadTempDirs()
  await fn()
  const after = await downloadTempDirs()
  expect(after.filter((name) => !before.includes(name))).toEqual([])
}

const THIRTY_SECONDS_MS = 30_000

describe('DEFAULT_TIMEOUT_MS', () => {
  it('is 30 seconds', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(THIRTY_SECONDS_MS)
  })
})

describe('MAX_FILE_SIZE_BYTES', () => {
  it('is 100 MB', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(100 * 1024 * 1024)
  })
})

describe('downloadFileToTemp successful download', () => {
  it('writes the body to a temp file and reports its size', async () => {
    mockSendWith({
      Body: makeBody([Buffer.from('hello '), Buffer.from('world')])
    })

    const result = await downloadFileToTemp(BUCKET, KEY)

    try {
      expect(await readFile(result.path, 'utf8')).toBe('hello world')
      expect(result.size).toBe('hello world'.length)
    } finally {
      await result.cleanup()
    }
  })

  it('never holds the object in memory as a Buffer', async () => {
    mockSendWith({ Body: makeBody([Buffer.from('hello')]) })

    const result = await downloadFileToTemp(BUCKET, KEY)

    try {
      // BMD-913: the contract is a path, not bytes — concurrent uploads must
      // not each keep a copy of their file on the heap.
      expect(typeof result.path).toBe('string')
      expect(Buffer.isBuffer(result)).toBe(false)
    } finally {
      await result.cleanup()
    }
  })

  it('writes an empty file when the body has no chunks', async () => {
    mockSendWith({ Body: makeBody([]) })

    const result = await downloadFileToTemp(BUCKET, KEY)

    try {
      expect(result.size).toBe(0)
      expect((await stat(result.path)).size).toBe(0)
    } finally {
      await result.cleanup()
    }
  })

  it('cleanup removes the temp file', async () => {
    mockSendWith({ Body: makeBody([Buffer.from('ok')]) })

    const result = await downloadFileToTemp(BUCKET, KEY)
    await result.cleanup()

    await expect(stat(result.path)).rejects.toThrow()
  })

  it('cleanup is safe to call twice', async () => {
    mockSendWith({ Body: makeBody([Buffer.from('ok')]) })

    const result = await downloadFileToTemp(BUCKET, KEY)
    await result.cleanup()

    await expect(result.cleanup()).resolves.not.toThrow()
  })

  it('passes the abortSignal through to client.send', async () => {
    const send = mockSendWith({ Body: makeBody([Buffer.from('ok')]) })

    const result = await downloadFileToTemp(BUCKET, KEY)
    await result.cleanup()

    const [, options] = send.mock.calls[0]
    expect(options).toHaveProperty('abortSignal')
  })
})

describe('downloadFileToTemp when client.send throws a timeout', () => {
  it('throws S3TimeoutError for a TimeoutError', async () => {
    mockSendRejecting(namedError('TimeoutError'))

    await expect(downloadFileToTemp(BUCKET, KEY)).rejects.toThrow(
      S3TimeoutError
    )
  })

  it('throws S3TimeoutError for an AbortError', async () => {
    mockSendRejecting(namedError('AbortError'))

    await expect(downloadFileToTemp(BUCKET, KEY)).rejects.toThrow(
      S3TimeoutError
    )
  })

  it('includes bucket and key in the S3TimeoutError message', async () => {
    mockSendRejecting(namedError('TimeoutError'))

    await expect(downloadFileToTemp(BUCKET, KEY)).rejects.toThrow(
      new RegExp(`${BUCKET}.*${KEY}|${KEY}.*${BUCKET}`)
    )
  })
})

describe('downloadFileToTemp when client.send throws a connection error', () => {
  it('throws S3ConnectionError for a generic error', async () => {
    mockSendRejecting(new Error('ECONNREFUSED'))

    await expect(downloadFileToTemp(BUCKET, KEY)).rejects.toThrow(
      S3ConnectionError
    )
  })

  it('includes the original message in the S3ConnectionError', async () => {
    mockSendRejecting(new Error('NoSuchKey'))

    await expect(downloadFileToTemp(BUCKET, KEY)).rejects.toThrow(/NoSuchKey/)
  })
})

describe('downloadFileToTemp when the body stream throws a timeout', () => {
  it('throws S3TimeoutError for a TimeoutError during streaming', async () => {
    mockSendWith({ Body: { [Symbol.asyncIterator]: failWithTimeout } })

    await expect(downloadFileToTemp(BUCKET, KEY)).rejects.toThrow(
      S3TimeoutError
    )
  })

  it('throws S3TimeoutError for an AbortError during streaming', async () => {
    mockSendWith({ Body: { [Symbol.asyncIterator]: failWithAbort } })

    await expect(downloadFileToTemp(BUCKET, KEY)).rejects.toThrow(
      S3TimeoutError
    )
  })
})

describe('downloadFileToTemp when the body stream throws a connection error', () => {
  it('throws S3ConnectionError for a generic stream error', async () => {
    mockSendWith({ Body: { [Symbol.asyncIterator]: failWithError } })

    await expect(downloadFileToTemp(BUCKET, KEY)).rejects.toThrow(
      S3ConnectionError
    )
  })

  it('includes the original message in the S3ConnectionError', async () => {
    mockSendWith({ Body: { [Symbol.asyncIterator]: failWithError } })

    await expect(downloadFileToTemp(BUCKET, KEY)).rejects.toThrow(
      /socket hang up/
    )
  })

  it('leaves no partial file behind', async () => {
    mockSendWith({ Body: { [Symbol.asyncIterator]: failWithError } })

    await expectingNoTempDirsLeft(async () => {
      await expect(downloadFileToTemp(BUCKET, KEY)).rejects.toThrow(
        S3ConnectionError
      )
    })
  })
})

describe('downloadFileToTemp when the S3 object exceeds MAX_FILE_SIZE_BYTES', () => {
  it('throws S3FileTooLargeError when Content-Length exceeds the limit', async () => {
    mockSendWith({
      Body: makeBody([]),
      ContentLength: MAX_FILE_SIZE_BYTES + 1
    })

    await expect(downloadFileToTemp(BUCKET, KEY)).rejects.toThrow(
      S3FileTooLargeError
    )
  })

  it('includes bucket, key and sizes in the error message', async () => {
    mockSendWith({
      Body: makeBody([]),
      ContentLength: MAX_FILE_SIZE_BYTES + 1
    })

    await expect(downloadFileToTemp(BUCKET, KEY)).rejects.toThrow(
      new RegExp(`${BUCKET}.*${KEY}|${KEY}.*${BUCKET}`)
    )
  })

  it('rejects before writing anything to disk', async () => {
    mockSendWith({
      Body: makeBody([]),
      ContentLength: MAX_FILE_SIZE_BYTES + 1
    })

    await expectingNoTempDirsLeft(async () => {
      await expect(downloadFileToTemp(BUCKET, KEY)).rejects.toThrow(
        S3FileTooLargeError
      )
    })
  })

  it('does not throw when Content-Length equals MAX_FILE_SIZE_BYTES', async () => {
    mockSendWith({
      Body: makeBody([Buffer.alloc(1)]),
      ContentLength: MAX_FILE_SIZE_BYTES
    })

    const result = await downloadFileToTemp(BUCKET, KEY)

    expect(result.size).toBe(1)
    await result.cleanup()
  })

  it('does not throw when Content-Length is absent', async () => {
    mockSendWith({ Body: makeBody([Buffer.from('ok')]) })

    const result = await downloadFileToTemp(BUCKET, KEY)

    expect(result.size).toBe(2)
    await result.cleanup()
  })
})

describe('downloadFileToTemp custom timeoutMs option', () => {
  it('accepts a custom timeout and still succeeds', async () => {
    mockSendWith({ Body: makeBody([Buffer.from('data')]) })

    const result = await downloadFileToTemp(BUCKET, KEY, { timeoutMs: 5_000 })

    try {
      expect(await readFile(result.path, 'utf8')).toBe('data')
    } finally {
      await result.cleanup()
    }
  })
})
