// The projection every single-feature READ selects, so that finding one feature
// no longer means shipping the whole project document.
//
// Item W4: GET /projects/{id}/features/{featureId} (and the habitat and
// post-intervention spellings of it) used to `.select()` every column, pull the
// entire `project` JSONB across the wire, JSON.parse it on the event loop and
// then `Array.find()` the one feature the caller asked for. The document grows
// with the site's feature count (~3 KB/parcel — 6 MB at 2k parcels), so a
// request for a few hundred bytes of feature deserialised megabytes to get it,
// on every call.
//
// Postgres can do the search itself. `jsonb_path_query_first` returns the first
// element of a layer whose featureId matches, so only that element is returned
// and only that element is parsed. One column per layer rather than a lateral
// join over all four: the layers are a fixed, known list, the match is at most
// one element per layer either way, and this spelling stays inside the drizzle
// query builder — the same shape as projectListColumns in project-list.js.
//
// This does NOT save the database any work: Postgres still detoasts and
// decompresses the whole document to evaluate the path. The saving is entirely
// on this side — no large string over the wire, no whole-document parse, no
// megabytes held live per in-flight request.
//
// The write path is deliberately untouched: applyFeatureUpdate re-totals units
// across every feature, so it legitimately needs the full document.
import { sql } from 'drizzle-orm'

import { projects } from './schema/index.js'
import { FEATURE_LAYERS } from '../utilities/features/find-feature.js'

// Matches the first element of a feature array carrying this featureId. The id
// is bound as a jsonpath VARIABLE rather than interpolated into the expression:
// building the path by concatenation would be a jsonpath injection.
const FEATURE_BY_ID_PATH = '$[*] ? (@.featureId == $f)'

/**
 * The one feature of `layer` carrying `featureId`, or SQL NULL when the layer
 * holds no such feature. `jsonb_path_query_first` is strict, so a document with
 * no such layer at all yields NULL rather than erroring — no COALESCE needed.
 */
function featureInLayer(documentKey, layer, featureId) {
  return sql`jsonb_path_query_first(
    ${projects.project} -> ${documentKey} -> ${layer},
    ${FEATURE_BY_ID_PATH}::jsonpath,
    jsonb_build_object('f', ${featureId}::text)
  )`
}

/**
 * Select map for a feature addressed by id alone: the project id, so a visible
 * project still returns a row when it holds no such feature, plus one column
 * per layer holding that layer's match.
 *
 * @param {{ documentKey: string, featureId: string }} params
 */
function featureByIdColumns({ documentKey, featureId }) {
  const columns = { id: projects.id }
  for (const { key } of FEATURE_LAYERS) {
    columns[key] = featureInLayer(documentKey, key, featureId).as(key)
  }
  return columns
}

/**
 * Select map for the habitat-only read, which addresses a single known layer
 * and so needs just the one column.
 *
 * @param {{ featureId: string }} params
 */
function habitatByIdColumns({ featureId }) {
  return {
    id: projects.id,
    habitat: featureInLayer('baseline', 'habitats', featureId).as('habitat')
  }
}

/**
 * Read the layer columns back as a single match, mirroring findFeature: the
 * featureId is expected to be unique across layers, and the same id appearing
 * in two of them means upstream data corruption, so it throws rather than
 * silently returning whichever layer was projected first.
 *
 * @param {object} row a row selected with {@link featureByIdColumns}
 * @param {string} featureId
 * @returns {{ type: string, key: string, feature: object } | null}
 * @throws {Error} when the same featureId appears in more than one layer
 */
function readFeatureMatch(row, featureId) {
  const matches = FEATURE_LAYERS.filter(({ key }) => row?.[key] != null).map(
    ({ type, key }) => ({ type, key, feature: row[key] })
  )
  if (matches.length > 1) {
    throw new Error(
      `featureId ${featureId} appears in multiple layers: ${matches
        .map((m) => m.type)
        .join(', ')}`
    )
  }
  return matches[0] ?? null
}

export { featureByIdColumns, habitatByIdColumns, readFeatureMatch }
