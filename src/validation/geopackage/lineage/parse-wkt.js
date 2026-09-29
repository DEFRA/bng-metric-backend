// A small WKT reader for the text in `parent_geom`, which comes from the
// uploaded file and so cannot be trusted.
//
// It reads only the six simple feature types a post-intervention row's parent
// can have: Point, LineString, Polygon and their Multi forms. Any other type
// (curves, collections), EWKT, trailing text or a malformed number makes the
// whole text unreadable.
//
// It runs in time linear in the length of the text: one forward pass, with
// sticky regular expressions that match only at the cursor. Arrays grow one
// push at a time, never by spreading an argument list, so a genuine geometry
// of any size is read rather than hitting the engine's argument limit.

/** GeoJSON type name for each WKT type name the reader accepts. */
const GEOJSON_TYPE = Object.freeze({
  POINT: 'Point',
  LINESTRING: 'LineString',
  POLYGON: 'Polygon',
  MULTIPOINT: 'MultiPoint',
  MULTILINESTRING: 'MultiLineString',
  MULTIPOLYGON: 'MultiPolygon'
})

/** Dimension words that may follow the type name: `POINT Z (1 2 3)`. */
const DIMENSION_WORDS = new Set(['Z', 'M', 'ZM'])

/**
 * A dimension written onto the type name: `PointZ`, `LINESTRINGM`. None of
 * the six type names ends in Z or M, so the suffix cannot eat into a name.
 */
const DIMENSION_SUFFIX = /(?:ZM|Z|M)$/

const EMPTY_WORD = 'EMPTY'

/** Ordinates a position may carry: x y, x y z or x y m, and x y z m. */
const MIN_ORDINATES = 2
const MAX_ORDINATES = 4

const WORD = /[A-Za-z]+/y
const NUMBER = /[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/y
const WHITESPACE = new Set([' ', '\t', '\n', '\r'])
const NUMBER_START = new Set([...'+-.0123456789'])

class WktSyntaxError extends Error {}

/** A cursor over the WKT text. Every method moves forward only. */
class WktCursor {
  constructor(text) {
    this.text = text
    this.index = 0
  }

  skipWhitespace() {
    while (WHITESPACE.has(this.text.charAt(this.index))) {
      this.index += 1
    }
  }

  /** The next non-blank character, or '' at the end of the text. */
  peek() {
    this.skipWhitespace()
    return this.text.charAt(this.index)
  }

  /** Consume `char` if it comes next. */
  accept(char) {
    if (this.peek() !== char) {
      return false
    }
    this.index += 1
    return true
  }

  expect(char) {
    if (!this.accept(char)) {
      throw new WktSyntaxError(`expected '${char}' at ${this.index}`)
    }
  }

  /** The text `pattern` matches at the cursor, consumed, or null. */
  match(pattern) {
    this.skipWhitespace()
    pattern.lastIndex = this.index
    const found = pattern.exec(this.text)
    if (found === null) {
      return null
    }
    this.index = pattern.lastIndex
    return found[0]
  }

  /** The next word, uppercased and consumed, or null when none comes next. */
  word() {
    return this.match(WORD)?.toUpperCase() ?? null
  }

  number() {
    const token = this.match(NUMBER)
    if (token === null) {
      throw new WktSyntaxError(`expected a number at ${this.index}`)
    }
    return Number(token)
  }

  atEnd() {
    this.skipWhitespace()
    return this.index === this.text.length
  }
}

/** `x y`, with up to two more ordinates. */
function readPosition(cursor) {
  const position = [cursor.number()]
  while (position.length < MAX_ORDINATES && NUMBER_START.has(cursor.peek())) {
    position.push(cursor.number())
  }
  if (position.length < MIN_ORDINATES) {
    throw new WktSyntaxError(`a position needs ${MIN_ORDINATES} ordinates`)
  }
  return position
}

/** `( item, item, ... )`, each item read by `readItem`. */
function readList(cursor, readItem) {
  cursor.expect('(')
  const items = [readItem(cursor)]
  while (cursor.accept(',')) {
    items.push(readItem(cursor))
  }
  cursor.expect(')')
  return items
}

function readPositionList(cursor) {
  return readList(cursor, readPosition)
}

function readRingList(cursor) {
  return readList(cursor, readPositionList)
}

/** A MultiPoint member: `(x y)` or a bare `x y`; WKT allows both. */
function readMultiPointMember(cursor) {
  if (!cursor.accept('(')) {
    return readPosition(cursor)
  }
  const position = readPosition(cursor)
  cursor.expect(')')
  return position
}

const BODY_READERS = Object.freeze({
  POINT: (cursor) => {
    cursor.expect('(')
    const position = readPosition(cursor)
    cursor.expect(')')
    return position
  },
  LINESTRING: readPositionList,
  POLYGON: readRingList,
  MULTIPOINT: (cursor) => readList(cursor, readMultiPointMember),
  MULTILINESTRING: readRingList,
  MULTIPOLYGON: (cursor) => readList(cursor, readRingList)
})

/** The type name, with any dimension suffix or dimension word consumed. */
function readTypeName(cursor) {
  const name = (cursor.word() ?? '').replace(DIMENSION_SUFFIX, '')
  if (!Object.hasOwn(GEOJSON_TYPE, name)) {
    throw new WktSyntaxError(`unsupported geometry type '${name}'`)
  }
  return name
}

/** True when the geometry is EMPTY; any other word is an error. */
function readEmpty(cursor) {
  let word = cursor.word()
  if (DIMENSION_WORDS.has(word)) {
    word = cursor.word()
  }
  if (word !== null && word !== EMPTY_WORD) {
    throw new WktSyntaxError(`unexpected word '${word}'`)
  }
  return word === EMPTY_WORD
}

/**
 * Read WKT into a GeoJSON geometry. An EMPTY geometry gives empty
 * coordinates. Returns null when the text is not a single Point, LineString,
 * Polygon or Multi form of one, or when anything follows the geometry.
 * Type names are matched in any case, as QGIS writes `Polygon` and Python
 * writers `POLYGON`.
 *
 * @param {string} text
 * @returns {{ type: string, coordinates: unknown[] } | null}
 */
export function parseWkt(text) {
  const cursor = new WktCursor(text)
  try {
    const name = readTypeName(cursor)
    const coordinates = readEmpty(cursor) ? [] : BODY_READERS[name](cursor)
    return cursor.atEnd() ? { type: GEOJSON_TYPE[name], coordinates } : null
  } catch (error) {
    if (error instanceof WktSyntaxError) {
      return null
    }
    throw error
  }
}
