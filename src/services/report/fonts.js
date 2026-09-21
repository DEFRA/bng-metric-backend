/**
 * Where the report's embedded body fonts come from.
 *
 * PDF/UA 7.21.4.1 requires every font PROGRAM to be embedded, so a report
 * always carries a subset of whatever typeface it was drawn with. That subset
 * travels with the document to everyone the document is forwarded to, which is
 * exactly what a font's "Preview & Print" embedding permission contemplates —
 * and it is why the choice of typeface is a licensing question rather than a
 * typographic one.
 *
 * Two sources, chosen by whether `reportFonts.bucket` is configured:
 *
 *   unset (the default)  the Noto Sans files committed in `assets/fonts`.
 *                        SIL OFL 1.1, so safe to hold in a public repository.
 *   set                  two objects fetched from a private S3 bucket at
 *                        startup. This is the seam GDS Transport goes through:
 *                        GOV.UK's typeface is licensed to GDS under a bilateral
 *                        agreement with its designers, is marked in its own name
 *                        table as "not commercially available", and cannot be
 *                        committed to a public repository. A private bucket
 *                        separates holding the font file — which the licence
 *                        constrains — from embedding a subset in a generated
 *                        document, which is the sanctioned use.
 *
 * Loaded ONCE, at startup, never per request. Three reasons, in order of how
 * much they would hurt:
 *
 *   1. `registerFonts` is synchronous by design. All I/O completes before any
 *      drawing starts, because pdfkit's drawing is sequential and stateful and
 *      an `await` in the middle of it silently corrupts both the layout and the
 *      tagged reading order. An await inside document construction is the exact
 *      shape of that bug.
 *   2. A per-request fetch would put a new failure mode on a path that cannot
 *      currently fail.
 *   3. A font is build-time-static data. Fetching it per request buys nothing.
 *
 * A configured bucket that cannot be read DEGRADES to the committed fonts,
 * warning as it does so — the same choice the basemap makes, and for the same
 * reason: a report in the fallback typeface is a correct, complete, accessible
 * report, and refusing to produce one because a bucket is unreachable would turn
 * a cosmetic dependency into an outage.
 *
 * The cost of that choice, stated plainly because it is not visible in the
 * output: unlike a missing basemap, a substituted typeface looks like a design
 * decision rather than a fault. The warning below is the ONLY signal that an
 * environment configured for a privately held font is not using it, so it names
 * the bucket, the reason and the consequence, and is logged at `warn` rather
 * than `info` so it survives a production log level.
 */

import path from 'node:path'
import { readFile } from 'node:fs/promises'

import { GetObjectCommand } from '@aws-sdk/client-s3'

import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { createS3Client } from '../s3/s3-client.js'

const logger = createLogger()

const FONT_DIR = path.resolve(import.meta.dirname, 'assets', 'fonts')
const BUNDLED_REGULAR = 'NotoSans-Regular.ttf'
const BUNDLED_BOLD = 'NotoSans-Bold.ttf'

/**
 * The first four bytes of every font container pdfkit can embed.
 *
 * Checked because the failure this guards against is otherwise invisible until
 * the first report is requested: S3 will happily serve a README under a key
 * named `.ttf`, and pdfkit only discovers that when it tries to parse it, in a
 * request, long after the deployment reported itself healthy.
 */
const FONT_SIGNATURES = Object.freeze([
  '00010000', // TrueType outlines
  '4f54544f', // 'OTTO' — CFF outlines
  '74727565', // 'true'
  '74746366', // 'ttcf' — TrueType collection
  '774f4646', // 'wOFF'
  '774f4632' // 'wOF2'
])

const SIGNATURE_BYTES = 4

/** The committed fonts, as buffers. */
async function bundledFonts() {
  const [regular, bold] = await Promise.all([
    readFile(path.join(FONT_DIR, BUNDLED_REGULAR)),
    readFile(path.join(FONT_DIR, BUNDLED_BOLD))
  ])
  return { regular, bold, source: 'bundled' }
}

function assertLooksLikeAFont(bytes, bucket, key) {
  const signature = bytes.subarray(0, SIGNATURE_BYTES).toString('hex')
  if (!FONT_SIGNATURES.includes(signature)) {
    throw new Error(
      `s3://${bucket}/${key} is not a font pdfkit can embed ` +
        `(leading bytes 0x${signature}); expected TrueType, OpenType, WOFF or WOFF2`
    )
  }
}

function assertWithinSizeLimit(size, maxBytes, bucket, key) {
  if (size > maxBytes) {
    throw new Error(
      `s3://${bucket}/${key} is ${size} bytes, over the ${maxBytes}-byte font limit`
    )
  }
}

/**
 * Fetch one font object, and prove it is a font before it is trusted.
 *
 * Size is checked twice — once from the declared `Content-Length`, so an
 * oversized object is refused before a byte is read, and again on what actually
 * arrived, because the header is the server's claim rather than a fact.
 */
async function fetchFont(client, bucket, key, { timeoutMs, maxBytes }) {
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { abortSignal: AbortSignal.timeout(timeoutMs) }
  )

  if (response.ContentLength) {
    assertWithinSizeLimit(response.ContentLength, maxBytes, bucket, key)
  }

  const bytes = Buffer.from(await response.Body.transformToByteArray())
  assertWithinSizeLimit(bytes.length, maxBytes, bucket, key)
  assertLooksLikeAFont(bytes, bucket, key)

  return bytes
}

/** The fonts held in the configured bucket, as buffers. */
async function bucketFonts(bucket) {
  const regularKey = config.get('reportFonts.regularKey')
  const boldKey = config.get('reportFonts.boldKey')
  const limits = {
    timeoutMs: config.get('reportFonts.timeoutMs'),
    maxBytes: config.get('reportFonts.maxBytes')
  }

  const client = createS3Client()
  try {
    const [regular, bold] = await Promise.all([
      fetchFont(client, bucket, regularKey, limits),
      fetchFont(client, bucket, boldKey, limits)
    ])
    return { regular, bold, source: 's3' }
  } catch (error) {
    // Named explicitly: the operator needs to know WHICH bucket, because the
    // whole point of this seam is that the font lives somewhere the repository
    // does not, and a missing IAM grant looks identical to a missing object.
    throw new Error(
      `Report fonts could not be read from s3://${bucket}: ${error.message}`,
      { cause: error }
    )
  } finally {
    client.destroy()
  }
}

/**
 * End a fragment with exactly one full stop.
 *
 * The warning below stitches an SDK message onto our own, and the SDK is not
 * consistent about punctuating: "The specified key does not exist." arrives with
 * one, "AccessDenied" without.
 */
function sentence(text) {
  return text.endsWith('.') ? text : `${text}.`
}

/**
 * Resolve the fonts this deployment embeds.
 *
 * @returns {Promise<{ regular: Buffer, bold: Buffer, source: 'bundled'|'s3' }>}
 */
async function loadReportFonts() {
  const bucket = config.get('reportFonts.bucket')

  if (!bucket) {
    const fonts = await bundledFonts()
    logger.info(
      `Report fonts: bundled (${BUNDLED_REGULAR}, ${BUNDLED_BOLD}); ` +
        'set REPORT_FONT_BUCKET to embed a privately held typeface instead'
    )
    return fonts
  }

  try {
    const fonts = await bucketFonts(bucket)
    logger.info(
      `Report fonts: s3://${bucket} ` +
        `(${fonts.regular.length} + ${fonts.bold.length} bytes)`
    )
    return fonts
  } catch (error) {
    // Deliberately not rethrown: see the header. Every report this instance
    // produces from here on is in the fallback typeface, and nothing in the
    // document says so, which is why this line has to.
    logger.warn(
      `${sentence(error.message)} Falling back to the bundled ${BUNDLED_REGULAR} / ` +
        `${BUNDLED_BOLD}: reports will render in Noto Sans, not the typeface ` +
        `s3://${bucket} was configured to supply.`
    )
    return bundledFonts()
  }
}

export { loadReportFonts }
