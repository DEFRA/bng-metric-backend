/**
 * What counts as a raster tile.
 *
 * The check exists because "200 OK" does not mean "a tile": a gateway in
 * front of api.os.uk can answer with an HTML error page, a 200, and a
 * `content-type` describing the page rather than the truth. Left unchecked
 * those bytes reach pdfkit's `doc.image`, which throws on anything it cannot
 * place — see tile-source.js and upstream.js.
 */

import { describe, expect, test } from 'vitest'

import { isPlaceableImage } from './image-format.js'

const PNG = Buffer.from('89504e470d0a1a0a', 'hex')
const JPEG = Buffer.from('ffd8ff', 'hex')

describe('#isPlaceableImage', () => {
  test('accepts a PNG', () => {
    expect(isPlaceableImage(Buffer.concat([PNG, Buffer.from('IHDR…')]))).toBe(
      true
    )
  })

  test('accepts a JPEG', () => {
    // OS serve PNG for a .png request, so this is defence rather than a path
    // in use — but doc.image places both, so both are tiles as far as the
    // report is concerned.
    expect(
      isPlaceableImage(
        Buffer.concat([JPEG, Buffer.from('e000104a464946', 'hex')])
      )
    ).toBe(true)
  })

  test('rejects an HTML error page served as a tile', () => {
    expect(
      isPlaceableImage(
        Buffer.from('<html><body>Service Unavailable</body></html>')
      )
    ).toBe(false)
  })

  test('rejects a body that merely starts like one', () => {
    // Two bytes of a PNG signature is not a PNG. Comparing a prefix shorter
    // than the signature would have said otherwise.
    expect(isPlaceableImage(Buffer.from('8950', 'hex'))).toBe(false)
  })

  test('rejects an empty body, and anything that is not a buffer', () => {
    expect(isPlaceableImage(Buffer.alloc(0))).toBe(false)
    expect(isPlaceableImage('89504e470d0a1a0a')).toBe(false)
    expect(isPlaceableImage(null)).toBe(false)
  })
})
