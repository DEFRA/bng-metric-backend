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
 * Walk a Joi `.describe()` output into the set of declared dotted paths,
 * recording which of those are open maps (`.unknown(true)` with no declared
 * keys) so {@link dataPaths} knows to stop descending at them.
 */
export function schemaPaths(node, basePath, declared, openPaths) {
  if (basePath) {
    declared.add(basePath)
  }
  const isOpenMap =
    node.type === 'object' && node.flags?.unknown === true && !node.keys
  if (isOpenMap) {
    if (basePath) {
      openPaths.add(basePath)
    }
    return
  }
  if (node.type === 'object' && node.keys) {
    for (const [key, child] of Object.entries(node.keys)) {
      schemaPaths(
        child,
        basePath ? `${basePath}.${key}` : key,
        declared,
        openPaths
      )
    }
  } else if (node.type === 'array' && node.items?.[0]) {
    schemaPaths(node.items[0], `${basePath}[]`, declared, openPaths)
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
  if (value !== null && typeof value === 'object') {
    if (basePath) {
      out.add(basePath)
    }
    for (const [key, child] of Object.entries(value)) {
      dataPaths(child, basePath ? `${basePath}.${key}` : key, openPaths, out)
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
  return [...observed].filter((path) => !declared.has(path)).sort()
}
