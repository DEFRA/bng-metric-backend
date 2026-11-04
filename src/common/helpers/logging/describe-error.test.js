import { describe, expect, it } from 'vitest'

import { describeError, loggableError, shorten } from './describe-error.js'

describe('#shorten', () => {
  it('puts a message on one line', () => {
    expect(shorten('Failed query: select\n  1\nparams: ')).toBe(
      'Failed query: select 1 params: '
    )
  })

  it('caps a long message at 500 characters', () => {
    expect(shorten('x'.repeat(5000))).toBe(`${'x'.repeat(500)}…`)
  })
})

describe('#describeError', () => {
  it('quotes a thrown value that is not an Error as it is', () => {
    expect(describeError('worker exited')).toBe('worker exited')
  })

  it('gives the type and message of any other error', () => {
    expect(describeError(new TypeError('nope'))).toBe('TypeError: nope')
  })

  it("caps a long message, such as an insert's parameters", () => {
    const described = describeError(new Error('x'.repeat(5000)))
    expect(described).toBe(`Error: ${'x'.repeat(500)}…`)
  })
})

describe('#loggableError', () => {
  // The ECS formatter writes an Error's message and stack in full, and the
  // stack opens with the message: a failed insert's geometry, twice.
  it('caps the message, in the stack too, and keeps the frames', () => {
    const huge = new Error('')
    huge.name = 'DrizzleQueryError'
    huge.message = `Failed query: insert params: ${'x'.repeat(5000)}`
    huge.stack = `DrizzleQueryError: ${huge.message}\n    at save (save.js:1:1)\n    at run (run.js:2:2)`

    const logged = loggableError(huge)

    expect(logged.message).toHaveLength(501)
    expect(logged.stack).toBe(
      `DrizzleQueryError: ${logged.message}\n    at save (save.js:1:1)\n    at run (run.js:2:2)`
    )
    expect(logged.stack.length).toBeLessThan(600)
  })

  it('keeps the error type, for ECS to name', () => {
    const logged = loggableError(new TypeError('nope'))

    expect(logged).toBeInstanceOf(TypeError)
    expect(logged.constructor.name).toBe('TypeError')
    expect(logged.name).toBe('TypeError')
    expect(logged.message).toBe('nope')
  })

  // pino takes a string first argument as the message, which would drop the
  // log line's own text.
  it('wraps a value that is not an Error', () => {
    const logged = loggableError('worker exited')

    expect(logged).toBeInstanceOf(Error)
    expect(logged.message).toBe('worker exited')
  })
})
