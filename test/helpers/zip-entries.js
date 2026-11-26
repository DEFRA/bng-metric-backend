import { inflateRawSync } from 'node:zlib'

/**
 * The parts of a zip (an .xlsx or .xlsm), by name, read with node's own
 * zlib, for tests that look inside a workbook the service wrote. Handles what
 * Office files use: stored or deflated entries, no zip64, no encryption.
 */

const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const CENTRAL_FILE_HEADER = 0x02014b50
const LOCAL_FILE_HEADER = 0x04034b50
const END_RECORD_LENGTH = 22
const CENTRAL_HEADER_LENGTH = 46
const LOCAL_HEADER_LENGTH = 30
const STORED = 0
const DEFLATED = 8

function endRecordOffset(buffer) {
  for (
    let offset = buffer.length - END_RECORD_LENGTH;
    offset >= 0;
    offset -= 1
  ) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
      return offset
    }
  }
  throw new Error('Not a zip: no end of central directory record')
}

function entryData(buffer, { localOffset, method, compressedSize }) {
  if (buffer.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
    throw new Error(`No local file header at ${localOffset}`)
  }
  const nameLength = buffer.readUInt16LE(localOffset + 26)
  const extraLength = buffer.readUInt16LE(localOffset + 28)
  const start = localOffset + LOCAL_HEADER_LENGTH + nameLength + extraLength
  const raw = buffer.subarray(start, start + compressedSize)
  if (method === STORED) {
    return Buffer.from(raw)
  }
  if (method === DEFLATED) {
    return inflateRawSync(raw)
  }
  throw new Error(`Unsupported zip compression method ${method}`)
}

/**
 * @param {Buffer} buffer
 * @returns {Map<string, Buffer>} each part's uncompressed bytes
 */
export function zipEntries(buffer) {
  const end = endRecordOffset(buffer)
  const count = buffer.readUInt16LE(end + 10)
  let offset = buffer.readUInt32LE(end + 16)
  const entries = new Map()
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) {
      throw new Error(`No central directory header at ${offset}`)
    }
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer
      .subarray(
        offset + CENTRAL_HEADER_LENGTH,
        offset + CENTRAL_HEADER_LENGTH + nameLength
      )
      .toString('utf8')
    entries.set(
      name,
      entryData(buffer, { localOffset, method, compressedSize })
    )
    offset += CENTRAL_HEADER_LENGTH + nameLength + extraLength + commentLength
  }
  return entries
}
