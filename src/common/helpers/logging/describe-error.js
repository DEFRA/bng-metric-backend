/**
 * Longest stretch of an error message worth logging. A failed query's message
 * from Drizzle is the whole query followed by its parameters, and an insert's
 * parameters carry every feature's geometry.
 */
const MAX_MESSAGE_LENGTH = 500

/**
 * A message on one line, capped at {@link MAX_MESSAGE_LENGTH}.
 *
 * @param {unknown} message
 * @returns {string}
 */
function shorten(message) {
  const text = String(message ?? '').replaceAll(/\s+/g, ' ')
  return text.length > MAX_MESSAGE_LENGTH
    ? `${text.slice(0, MAX_MESSAGE_LENGTH)}…`
    : text
}

/**
 * An error, for a log line: its type and its message, capped. A thrown
 * string or the like has no name or message to quote, so it is quoted as it
 * is.
 *
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
  if (!(error instanceof Error)) {
    return shorten(error)
  }
  return `${error.name}: ${shorten(error.message)}`
}

/** A stack trace's frames, without the `Name: message` header above them. */
function stackFrames(stack) {
  const lines = String(stack ?? '').split('\n')
  const firstFrame = lines.findIndex((line) => /^\s+at /.test(line))
  return firstFrame === -1 ? [] : lines.slice(firstFrame)
}

/**
 * An error for the logger's error fields, its message capped as
 * {@link describeError} caps it. The ECS formatter writes an Error's message
 * and stack in full, and a stack opens with the message, so logging a failed
 * insert itself would write every feature's geometry into the line twice.
 * The copy keeps the error's type and its stack's frames. A value that is
 * not an Error is wrapped in one, so it cannot take the log line's message.
 *
 * @param {unknown} error
 * @returns {Error}
 */
function loggableError(error) {
  if (!(error instanceof Error)) {
    return new Error(shorten(error))
  }
  const copy = Object.create(Object.getPrototypeOf(error))
  const message = shorten(error.message)
  const header = `${error.name}: ${message}`
  Object.defineProperties(copy, {
    name: { value: error.name, writable: true, configurable: true },
    message: { value: message, writable: true, configurable: true },
    stack: {
      value: [header, ...stackFrames(error.stack)].join('\n'),
      writable: true,
      configurable: true
    }
  })
  return copy
}

export { describeError, loggableError, shorten }
