/**
 * A tile cache for tests: a Map, with no eviction and no TTL.
 *
 * Production's cache is a catbox policy the plugin provisions
 * (`plugins/os-tiles.js`), and `plugins/os-tiles.test.js` exercises that one
 * through a real Hapi server. What the service's own tests need is the far
 * smaller question of whether it consults a cache at all, and derives a key
 * that keeps one tile apart from another — so a Map answers it without the
 * assertions depending on anyone's eviction policy.
 */
function stubTileCache() {
  const entries = new Map()
  return {
    get: async (key) => entries.get(key) ?? null,
    set: async (key, value) => entries.set(key, value),
    size: () => entries.size
  }
}

export { stubTileCache }
