/**
 * The font seam, which exists so a typeface the repository is not allowed to
 * hold can still be embedded in the report.
 *
 * Two behaviours matter more than the plumbing: with no bucket configured the
 * service is unchanged (it embeds the committed Noto Sans), and with a bucket
 * configured that cannot be read it DEGRADES to those same fonts rather than
 * failing — a report in the fallback typeface is still correct, complete and
 * accessible, and a bucket outage should not become a report outage.
 *
 * The substitution is invisible in the output, so the warning is the only
 * signal an operator gets. It is asserted on as carefully as the bytes are.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../s3/s3-client.js')

// One logger object, not one per call: fonts.js calls createLogger() once at
// module load, so the spy has to outlive that.
const { logger } = vi.hoisted(() => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} }
}))
vi.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => logger
}))

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

/** Everything logged at warn since the last test, as strings. */
function warnings() {
  return vi.mocked(logger.warn).mock.calls.map(([message]) => message)
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(logger, 'warn').mockImplementation(() => {})
  vi.spyOn(logger, 'info').mockImplementation(() => {})
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

  test('releases the client even when the fetch fails', async () => {
    const { destroy } = s3Returning({})
    configure()

    await loadReportFonts()

    expect(destroy).toHaveBeenCalledTimes(1)
  })

  test('refuses an object that is not a font pdfkit can embed', async () => {
    s3Returning({
      'Regular.ttf': objectOf(Buffer.from('# Fonts live here\n')),
      'Bold.ttf': objectOf(fontBytes())
    })
    configure()

    // The point of the check: S3 serves a README under a .ttf key perfectly
    // happily, and without it pdfkit only finds out inside the first request.
    const fonts = await loadReportFonts()

    expect(fonts.source).toBe('bundled')
    expect(warnings()).toContainEqual(
      expect.stringContaining('is not a font pdfkit can embed')
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

    await loadReportFonts()

    expect(warnings()).toContainEqual(
      expect.stringContaining('over the 5242880-byte')
    )
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

    await loadReportFonts()

    expect(warnings()).toContainEqual(
      expect.stringContaining('over the 100-byte')
    )
  })
})

describe('#loadReportFonts falling back', () => {
  test('embeds the committed fonts when the bucket cannot be read', async () => {
    s3Returning({})
    configure()

    const fonts = await loadReportFonts()

    // Degrading, not failing: a report in the fallback typeface is still
    // correct, complete and accessible, and a bucket outage should not become
    // a report outage.
    expect(fonts.source).toBe('bundled')
    expect(fonts.regular.subarray(0, 4).toString('hex')).toBe('00010000')
  })

  test('warns with the bucket, the reason and the consequence', async () => {
    s3Returning({})
    configure()

    await loadReportFonts()

    // The substitution is invisible in the document — it reads as a design
    // decision, not a fault — so this line is the only signal an operator
    // gets that a configured typeface is not being used.
    const [warning] = warnings()
    expect(warning).toContain(`s3://${BUCKET}`)
    expect(warning).toContain('NoSuchKey')
    expect(warning).toContain('Falling back to the bundled')
    expect(warning).toContain('Noto Sans')
  })

  test('does not double the full stop on an SDK message that has one', async () => {
    // "The specified key does not exist." arrives punctuated; "AccessDenied"
    // does not. Both get stitched onto our sentence.
    const send = vi.fn().mockRejectedValue(new Error('Access is denied.'))
    vi.mocked(createS3Client).mockReturnValue({ send, destroy: vi.fn() })
    configure()

    await loadReportFonts()

    expect(warnings()[0]).toContain('Access is denied. Falling back')
  })

  test('warns rather than informs, so it survives a production log level', async () => {
    s3Returning({})
    configure()

    await loadReportFonts()

    expect(warnings()).toHaveLength(1)
  })
})
