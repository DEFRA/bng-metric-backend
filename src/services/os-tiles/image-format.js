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

/**
 * The signatures, as hex rather than as byte arrays — the spelling the specs
 * themselves use, so each can be read against its source without decoding a
 * list of numbers:
 *
 *   PNG   89 50 4E 47 0D 0A 1A 0A  =  \x89 P N G \r \n \x1a \n
 *   JPEG  FF D8 FF                 =  SOI, then the first marker
 */
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex')
const JPEG_SIGNATURE = Buffer.from('ffd8ff', 'hex')

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
