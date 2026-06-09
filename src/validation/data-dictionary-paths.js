// Path helpers shared by the data-dictionary coverage guards (the in-process
// unit guard in project-coverage.test.js and the integration read-back guard in
// integration-tests/data-dictionary-coverage.test.js).
//
// Both guards need to compare "what the code persisted" against "what the Joi
// schema declares" as comparable sets of dotted key-paths. Keeping the walk in
// one place guarantees the two guards stay in lockstep — array indices collapse
// to `[]` and `.unknown(true)` maps (e.g. `*.properties`) are treated as opaque
// leaves on both sides, so they compare like for like.

/**
 * True when a Joi node is an open map — an object declared with `.unknown(true)`
 * and no explicit keys (e.g. a `*.properties` blob). Both walks treat these as
 * opaque leaves and stop descending.
 */
function isOpenMap(node) {
  return node.type === 'object' && node.flags?.unknown === true && !node.keys
}

/** The declared keys of an object node, or null if it declares none. */
function objectKeys(node) {
  return node.type === 'object' && node.keys ? node.keys : null
}

/** The element schema of an array node, or undefined if there is none. */
function arrayItem(node) {
  return node.type === 'array' ? node.items?.[0] : undefined
}

/** Append `key` to `basePath`, or start a fresh path when at the root. */
function childPath(basePath, key) {
  return basePath ? `${basePath}.${key}` : key
}

/** True for a non-null object value (arrays are handled before this is asked). */
function isNonNullObject(value) {
  return value !== null && typeof value === 'object'
}

/**
 * Walk a Joi `.describe()` output into the set of declared dotted paths,
 * recording which of those are open maps (`.unknown(true)` with no declared
 * keys) so {@link dataPaths} knows to stop descending at them.
 */
export function schemaPaths(node, basePath, declared, openPaths) {
  if (basePath) {
    declared.add(basePath)
  }
  if (isOpenMap(node)) {
    if (basePath) {
      openPaths.add(basePath)
    }
    return
  }
  const keys = objectKeys(node)
  const item = arrayItem(node)
  if (keys) {
    for (const [key, child] of Object.entries(keys)) {
      schemaPaths(child, childPath(basePath, key), declared, openPaths)
    }
  } else if (item) {
    schemaPaths(item, `${basePath}[]`, declared, openPaths)
  } else {
    // leaf node — nothing further to descend into
  }
}

/**
 * Flatten a JSON value into the set of dotted key-paths it occupies. Array
 * indices collapse to `[]`; paths in `openPaths` are treated as opaque leaves
 * and not descended into.
 */
export function dataPaths(value, basePath, openPaths, out) {
  if (basePath && openPaths.has(basePath)) {
    out.add(basePath)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      dataPaths(item, `${basePath}[]`, openPaths, out)
    }
    return
  }
  if (isNonNullObject(value)) {
    if (basePath) {
      out.add(basePath)
    }
    for (const [key, child] of Object.entries(value)) {
      dataPaths(child, childPath(basePath, key), openPaths, out)
    }
    return
  }
  if (basePath) {
    out.add(basePath)
  }
}

/**
 * Return the sorted list of paths present in `value` but not declared by the Joi
 * `schema`. An empty array means the value is fully covered by the schema (and
 * therefore by the generated data dictionary).
 */
export function undeclaredPaths(value, schema) {
  const declared = new Set()
  const openPaths = new Set()
  schemaPaths(schema.describe(), '', declared, openPaths)
  const observed = new Set()
  dataPaths(value, '', openPaths, observed)
  return [...observed]
    .filter((path) => !declared.has(path))
    .sort((a, b) => a.localeCompare(b))
}
