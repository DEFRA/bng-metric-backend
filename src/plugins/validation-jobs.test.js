import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../services/validation-jobs/dispatcher.js', () => ({
  createValidationJobDispatcher: vi.fn()
}))

const { createValidationJobDispatcher } =
  await import('../services/validation-jobs/dispatcher.js')
const { validationJobs } = await import('./validation-jobs.js')
const { config } = await import('../config.js')

function makeServer() {
  const decorations = {}
  const listeners = new Map()
  return {
    decorations,
    listeners,
    drizzle: { tag: 'drizzle' },
    pg: { tag: 'pool' },
    decorate: vi.fn((_target, name, value) => {
      decorations[name] = value
    }),
    events: {
      on: vi.fn((event, handler) => listeners.set(event, handler))
    }
  }
}

let dispatcher

beforeEach(() => {
  vi.clearAllMocks()
  dispatcher = { start: vi.fn(), stop: vi.fn() }
  vi.mocked(createValidationJobDispatcher).mockReturnValue(dispatcher)
})

describe('validation-jobs plugin', () => {
  it('builds the dispatcher from the server pool and Drizzle handle', async () => {
    // Registered after the postgres plugin, which decorates both onto the
    // server; the dispatcher runs outside any request so it cannot use
    // request.drizzle.
    const server = makeServer()

    await validationJobs.plugin.register(server)

    expect(createValidationJobDispatcher).toHaveBeenCalledWith({
      drizzle: server.drizzle,
      pgPool: server.pg,
      settings: expect.objectContaining({
        maxConcurrentJobs: config.get('asyncValidation.maxConcurrentJobs'),
        leaseMs: config.get('asyncValidation.leaseMs'),
        maxAttempts: config.get('asyncValidation.maxAttempts'),
        retentionMs: config.get('asyncValidation.retentionMs'),
        pollIntervalMs: config.get('asyncValidation.pollIntervalMs')
      })
    })
  })

  it('exposes the dispatcher so the enqueue route can nudge it', async () => {
    const server = makeServer()

    await validationJobs.plugin.register(server)

    expect(server.decorations.validationJobDispatcher).toBe(dispatcher)
    expect(server.decorate).toHaveBeenCalledWith(
      'request',
      'validationJobDispatcher',
      dispatcher
    )
  })

  it('starts the dispatcher when the server starts', async () => {
    const server = makeServer()
    await validationJobs.plugin.register(server)

    server.listeners.get('start')()

    expect(dispatcher.start).toHaveBeenCalledTimes(1)
  })

  it('stops the dispatcher when the server stops', async () => {
    // Without this a redeploy would leave claimed jobs to time out on their
    // lease rather than finishing and answering the user.
    const server = makeServer()
    await validationJobs.plugin.register(server)

    server.listeners.get('stop')()

    expect(dispatcher.stop).toHaveBeenCalledTimes(1)
  })
})
