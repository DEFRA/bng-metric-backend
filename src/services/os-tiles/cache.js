/**
 * Tile cache — bounded, TTL'd, process-local.
 *
 * Caching matters more for a generated PDF than for a browser map. A browser
 * user pans once and their own browser caches the result; a report re-fetches
 * the same site's tiles on every download. One site map is ~30 tiles, and the
 * per-parcel thumbnails push that well past 100 on a large site, most of them
 * repeats because neighbouring parcels overlap.
 *
 * Process-local is a deliberate starting point, not an oversight: this service
 * has no Redis (the frontend has `ioredis` + `catbox-redis`; this side has
 * neither), and adding one is a platform request rather than a code change.
 * Per-instance caching already collapses the repeats *within* a single report,
 * which is where the bulk of the duplication is. If cross-instance reuse turns
 * out to matter, this interface — `get(key)` / `set(key, buffer)` — is the seam
 * a Redis implementation drops into, and NRF's
 * `nrf-frontend/src/server/common/services/tile-cache.js` is the shape to copy.
 */

/**
 * Insertion-ordered eviction (oldest first) rather than true LRU — for tiles
 * the difference is not worth a linked list, because a document fetches its
 * working set once and in a burst.
 */
function memoryTileCache({ maxEntries = 2000, ttlSeconds = 3600 } = {}) {
  const entries = new Map()
  const ttlMs = ttlSeconds * 1000
  let hits = 0
  let misses = 0

  function evictIfFull() {
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value
      entries.delete(oldest)
    }
  }

  return {
    name: 'memory',

    async get(key, now = Date.now()) {
      const entry = entries.get(key)
      if (!entry) {
        misses += 1
        return null
      }
      if (entry.expiresAt <= now) {
        entries.delete(key)
        misses += 1
        return null
      }
      hits += 1
      return entry.buffer
    },

    async set(key, buffer, now = Date.now()) {
      // Re-inserting moves the key to the end of the iteration order, which is
      // what keeps eviction meaningful for keys that are re-fetched.
      entries.delete(key)
      entries.set(key, { buffer, expiresAt: now + ttlMs })
      evictIfFull()
    },

    async clear() {
      const count = entries.size
      entries.clear()
      return count
    },

    stats() {
      return { hits, misses, size: entries.size }
    }
  }
}

function tileKey({ layer, z, col, row }) {
  return `${layer}/${z}/${col}/${row}`
}

export { memoryTileCache, tileKey }
