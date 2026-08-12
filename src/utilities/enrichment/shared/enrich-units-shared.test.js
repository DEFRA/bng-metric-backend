import { describe, it, expect, vi } from 'vitest'

import {
  enrichCollectionIfNonEmpty,
  NO_OP_LOGGER
} from './enrich-units-shared.js'

describe('enrichCollectionIfNonEmpty', () => {
  it('calls enricher for each item in a non-empty collection', () => {
    const enricher = vi.fn()
    enrichCollectionIfNonEmpty([{ id: 1 }, { id: 2 }], enricher, NO_OP_LOGGER)

    expect(enricher).toHaveBeenCalledTimes(2)
  })

  it('does nothing when collection is empty', () => {
    const enricher = vi.fn()
    enrichCollectionIfNonEmpty([], enricher, NO_OP_LOGGER)

    expect(enricher).not.toHaveBeenCalled()
  })

  it('does nothing when collection is undefined', () => {
    const enricher = vi.fn()
    enrichCollectionIfNonEmpty(undefined, enricher, NO_OP_LOGGER)

    expect(enricher).not.toHaveBeenCalled()
  })
})
