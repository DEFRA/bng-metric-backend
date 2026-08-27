/**
 * Basemap tile sources for the report.
 *
 * One interface — `(grid, z, col, row) => Promise<{ png: Buffer }>` — with two
 * production callers' worth of behaviour behind it:
 *
 *  - `osTileSource(osTiles)` serves tiles from the OS tiles service, which is
 *    the only thing that holds an API key.
 *  - no tile source at all (`null`) means no basemap. That is the default, and
 *    it is a licensing position rather than a technical one: OS have not yet
 *    been asked whether we may embed their mapping in a PDF, which is a
 *    different question from displaying it in a browser because a PDF is
 *    redistributable. Until that is answered the report renders the geometry
 *    on a plain ground, which needs no permission from anybody.
 *
 * The tests add a third — a synthetic basemap whose tiles state where they
 * are — so registration can be proved offline. See
 * `synthetic-tiles.test-fixtures.js`.
 */

/**
 * Tiles from the OS tiles service, memoised for the life of one document.
 *
 * The service has its own cache; this second, tiny one exists because a single
 * report asks for the same tile many times over (neighbouring parcels overlap),
 * and there is no reason to round-trip an async cache for an answer already in
 * hand.
 */
function osTileSource(osTiles) {
  const seen = new Map()

  return async function fromOsTiles(_grid, z, col, row) {
    const key = `${z}/${col}/${row}`
    if (!seen.has(key)) {
      seen.set(
        key,
        osTiles.getTile(z, col, row).then(({ png }) => ({ png }))
      )
    }
    return seen.get(key)
  }
}

export { osTileSource }
