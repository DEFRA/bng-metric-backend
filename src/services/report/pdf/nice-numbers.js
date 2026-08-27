/**
 * Snapping a measurement to a number a human reads without effort.
 *
 * Both the scale bar and the graticule want the same 1/2/5 series — "200 m",
 * not "187 m" — differing only in which way they round. Shared so the two
 * cannot drift apart, and so the series itself is stated once.
 */

const DECADE = 10

/** The steps within a decade that people read distances in. */
const ROUND_STEPS = Object.freeze([1, 2, DECADE / 2, DECADE])

function decadeBelow(value) {
  return 10 ** Math.floor(Math.log10(value))
}

/**
 * The smallest round step that is at least `target` — used where a value must
 * cover a minimum, such as the graticule interval spanning a tile.
 */
function smallestStepAtLeast(target) {
  const magnitude = decadeBelow(target)
  for (const step of ROUND_STEPS) {
    if (step * magnitude >= target) {
      return step * magnitude
    }
  }
  return DECADE * magnitude
}

/**
 * The largest round step that fits within `limit` — used where a value must
 * not overflow, such as a scale bar inside its frame.
 */
function largestStepAtMost(limit) {
  const magnitude = decadeBelow(limit)
  let chosen = magnitude
  for (const step of ROUND_STEPS) {
    if (step * magnitude <= limit) {
      chosen = step * magnitude
    }
  }
  return chosen
}

export { largestStepAtMost, smallestStepAtLeast }
