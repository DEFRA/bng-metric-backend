/**
 * The font seam, which exists so a typeface the repository is not allowed to
 * hold can still be embedded in the report.
 *
 * Two behaviours matter more than the plumbing: with no bucket configured the
 * service is unchanged (it embeds the committed Noto Sans), and with a bucket
 * configured that cannot be read it FAILS rather than quietly falling back —
 * because an environment told to use a specific typeface and silently using a
 * different one is the outcome this seam exists to prevent.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../s3/s3-client.js')

const { loadReportFonts } = await import('./fonts.js')
const { createS3Client } = await import('../s3/s3-client.js')
const { config } = await import('../../config.js')

const BUCKET = 'bng-metric-report-fonts'
const TRUETYPE = Buffer.from([0x00, 0x01, 0x00, 0x00])

/** Bytes that begin like a real TrueType file, padded to a plausible size. */
function fontBytes(padding = 64) {
  return Buffer.concat([TRUETYPE, Buffer.alloc(padding, 0x2a)])
}

/** An S3 client whose GetObject resolves the given body for every key. */
function s3Returning(bodies) {
  const send = vi.fn().mockImplementation((command) => {
    const key = command.input.Key
    const body = bodies[key]
    if (!body) {
      return Promise.reject(new Error(`NoSuchKey: ${key}`))
    }
    return Promise.resolve(body)
  })
  const destroy = vi.fn()
  vi.mocked(createS3Client).mockReturnValue({ send, destroy })
  return { send, destroy }
}

/** A GetObject response carrying these bytes. */
function objectOf(bytes) {
  return {
    ContentLength: bytes.length,
    Body: { transformToByteArray: () => Promise.resolve(bytes) }
  }
}

function configure(overrides = {}) {
  const values = {
    'reportFonts.bucket': BUCKET,
    'reportFonts.regularKey': 'Regular.ttf',
    'reportFonts.boldKey': 'Bold.ttf',
    'reportFonts.timeoutMs': 10000,
    'reportFonts.maxBytes': 5242880,
    ...overrides
  }
  vi.spyOn(config, 'get').mockImplementation((key) => values[key])
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('#loadReportFonts with no bucket configured', () => {
  test('embeds the committed Noto Sans, and reads no S3 at all', async () => {
    configure({ 'reportFonts.bucket': '' })

    const fonts = await loadReportFonts()

    expect(fonts.source).toBe('bundled')
    expect(createS3Client).not.toHaveBeenCalled()
  })

  test('returns real font programs, not empty buffers', async () => {
    configure({ 'reportFonts.bucket': '' })

    const { regular, bold } = await loadReportFonts()

    // 0x00010000 is the TrueType signature: proof these are the font files and
    // not, say, a missing-file path that resolved to something empty.
    for (const font of [regular, bold]) {
      expect(font.length).toBeGreaterThan(1000)
      expect(font.subarray(0, 4).toString('hex')).toBe('00010000')
    }
  })
})

describe('#loadReportFonts with a bucket configured', () => {
  test('fetches both weights and reports the S3 source', async () => {
    const regular = fontBytes(100)
    const bold = fontBytes(200)
    const { send } = s3Returning({
      'Regular.ttf': objectOf(regular),
      'Bold.ttf': objectOf(bold)
    })
    configure()

    const fonts = await loadReportFonts()

    expect(fonts).toMatchObject({ source: 's3', regular, bold })
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls.map(([command]) => command.input)).toEqual(
      expect.arrayContaining([
        { Bucket: BUCKET, Key: 'Regular.ttf' },
        { Bucket: BUCKET, Key: 'Bold.ttf' }
      ])
    )
  })

  test('releases the client once the fonts are in memory', async () => {
    const { destroy } = s3Returning({
      'Regular.ttf': objectOf(fontBytes()),
      'Bold.ttf': objectOf(fontBytes())
    })
    configure()

    await loadReportFonts()

    expect(destroy).toHaveBeenCalledTimes(1)
  })

  test('names the bucket when an object is missing', async () => {
    s3Returning({ 'Regular.ttf': objectOf(fontBytes()) })
    configure()

    await expect(loadReportFonts()).rejects.toThrow(
      `Report fonts could not be read from s3://${BUCKET}`
    )
  })

  test('releases the client even when the fetch fails', async () => {
    const { destroy } = s3Returning({})
    configure()

    await expect(loadReportFonts()).rejects.toThrow()
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  test('rejects an object that is not a font pdfkit can embed', async () => {
    s3Returning({
      'Regular.ttf': objectOf(Buffer.from('# Fonts live here\n')),
      'Bold.ttf': objectOf(fontBytes())
    })
    configure()

    // The point of the check: S3 serves a README under a .ttf key perfectly
    // happily, and without this the failure surfaces inside the first request
    // long after the deployment reported itself healthy.
    await expect(loadReportFonts()).rejects.toThrow(
      'is not a font pdfkit can embed'
    )
  })

  test.each([
    ['WOFF', '774f4646'],
    ['WOFF2', '774f4632'],
    ['OpenType/CFF', '4f54544f']
  ])('accepts a %s container', async (_label, signature) => {
    const bytes = Buffer.concat([
      Buffer.from(signature, 'hex'),
      Buffer.alloc(64)
    ])
    s3Returning({
      'Regular.ttf': objectOf(bytes),
      'Bold.ttf': objectOf(bytes)
    })
    configure()

    await expect(loadReportFonts()).resolves.toMatchObject({ source: 's3' })
  })

  test('refuses an oversized object from its declared length', async () => {
    const bytes = fontBytes()
    s3Returning({
      'Regular.ttf': { ...objectOf(bytes), ContentLength: 6_000_000 },
      'Bold.ttf': objectOf(bytes)
    })
    configure()

    await expect(loadReportFonts()).rejects.toThrow('over the 5242880-byte')
  })

  test('refuses an oversized object that declared no length', async () => {
    const bytes = fontBytes()
    s3Returning({
      'Regular.ttf': {
        ContentLength: undefined,
        Body: {
          transformToByteArray: () =>
            Promise.resolve(Buffer.concat([TRUETYPE, Buffer.alloc(200)]))
        }
      },
      'Bold.ttf': objectOf(bytes)
    })
    configure({ 'reportFonts.maxBytes': 100 })

    await expect(loadReportFonts()).rejects.toThrow('over the 100-byte')
  })
})
