/**
 * The one thing on the summary page that a rendered document cannot be asked
 * about: the wording of the note that says the report is a partial one.
 *
 * Text drawn into a PDF lives in a compressed content stream, and the fonts
 * are embedded as subsets, so its bytes are glyph ids rather than characters
 * (see document.test.js). The sentence is therefore built by a pure function
 * and read here; document.test.js checks it reaches the page as a tagged
 * paragraph.
 */

import { describe, expect, test } from 'vitest'

import { cappedNoteText } from './summary-page.js'

describe('#cappedNoteText', () => {
  test('says nothing when the whole site is shown', () => {
    expect(cappedNoteText({ capped: [] }, null)).toBeNull()
  })

  test('names the layer, how much is shown and how much exists', () => {
    const note = cappedNoteText(
      { capped: [{ layer: 'habitats', shown: 500, total: 1240 }] },
      null
    )

    expect(note).toContain(
      'This report shows the first 500 of 1240 baseline habitat parcels.'
    )
    // Why, not just what: a reader who finds a parcel missing needs to know
    // the service still holds it.
    expect(note).toContain('its own screens list them all')
  })

  test('accounts for each side separately', () => {
    const note = cappedNoteText(
      { capped: [{ layer: 'habitats', shown: 2, total: 9 }] },
      { capped: [{ layer: 'hedgerows', shown: 2, total: 4 }] }
    )

    expect(note).toContain('2 of 9 baseline habitat parcels')
    expect(note).toContain('2 of 4 post-intervention hedgerows')
  })

  test('still says so when the document cannot supply a total', () => {
    // A layer with geometry rows but no matching document array should not
    // happen — they are written together — but "the first 500 of null" would
    // be a worse answer than dropping the denominator.
    const note = cappedNoteText(
      { capped: [{ layer: 'trees', shown: 500, total: null }] },
      null
    )

    expect(note).toContain(
      'This report shows only the first 500 baseline individual trees.'
    )
  })
})
