import { ERROR_CODES, makeError } from './errors.js'
import { PROP_KEYS, pickProp } from './properties.js'

const SAMPLE_CAP = 50
const FIRST_DUPLICATE_INSTANCE = 2

/**
 * Scan the area habitats layer for repeated Parcel Ref values. Each duplicated
 * ref is reported once, with the layer indexes of every habitat that shares
 * that ref. Habitats with a missing or blank ref are ignored — that is a
 * separate schema concern.
 *
 * `details.count` is the number of *distinct duplicated refs* (not the number
 * of offending features) — e.g. PR-1 appearing 3× and PR-2 appearing 2× yields
 * `count: 2`. This differs from distinctiveness-check, where `count` is the
 * number of offending features.
 *
 * @param {object} layers Output of readGeoPackage
 * @returns {{ code: string, message: string, details: { count: number, sample: Array<{ ref: string, indices: number[], count: number }> } }|null}
 */
export function checkDuplicateHabitatRefs(layers) {
  const features = layers?.areas ?? []
  const byRef = new Map()
  features.forEach((feature, idx) => {
    const ref = pickProp(feature?.properties ?? {}, PROP_KEYS.parcelRef)
    if (ref == null || ref === '') {
      return
    }
    const key = String(ref)
    const indices = byRef.get(key) ?? []
    indices.push(idx)
    byRef.set(key, indices)
  })

  const duplicates = []
  for (const [ref, indices] of byRef) {
    if (indices.length >= FIRST_DUPLICATE_INSTANCE) {
      duplicates.push({ ref, indices, count: indices.length })
    }
  }

  if (duplicates.length === 0) {
    return null
  }

  const sample = duplicates.slice(0, SAMPLE_CAP)
  const shown = sample.map((d) => `${d.ref} (${d.count})`).join(', ')
  const more =
    duplicates.length > sample.length
      ? ` (and ${duplicates.length - sample.length} more)`
      : ''

  return makeError(
    ERROR_CODES.DUPLICATE_HABITAT_REF,
    `One or more habitats share the same Parcel Ref: ${shown}${more}`,
    { count: duplicates.length, sample }
  )
}
