/**
 * Is this buffer actually a raster image?
 *
 * Asked of every raster tile, because "200 OK" does not mean "a tile". A
 * gateway or a CDN in front of api.os.uk can answer a tile request with an
 * HTML error page and a 200, and the `content-type` header travels with that
 * page rather than with the truth — so the bytes are what gets checked.
 *
 * PNG and JPEG are the list because they are exactly what pdfkit's
 * `doc.image` can place. Anything else is not a tile this service can serve
 * or this report can draw, whatever the response said it was.
 */

/** \x89PNG\r\n\x1a\n — the 8-byte signature every PNG opens with. */
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
])

/** SOI followed by the first marker — the 3 bytes every JPEG opens with. */
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff])

function isPlaceableImage(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    return false
  }
  return (
    buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    buffer.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)
  )
}

export { isPlaceableImage }
