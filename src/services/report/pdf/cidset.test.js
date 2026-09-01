/**
 * A guard for the one PDF/UA failure a conformance checker finds and no other
 * test would: an embedded font whose `/CIDSet` under-reports its own glyphs.
 *
 * pdfkit builds `/CIDSet` from its own width table, but fontkit's subsetter also
 * pulls in the COMPONENT glyphs of any composite glyph it includes. A composite
 * ligature therefore lands in the embedded font program carrying a component
 * pdfkit never assigned a CID to, and PDF/UA 7.21.4.2-2 fails — on a document
 * that renders perfectly.
 *
 * Noto Sans Bold's "fi" is such a ligature and "Modified grassland" is a
 * standard UKHab type, so the card layout hit this immediately on the default
 * fixture. `dataText()` turns ligatures off for user-supplied text, which is
 * the text whose characters we cannot predict.
 *
 * Asserting the invariant directly — every glyph in the subset has a CID —
 * catches the whole class without veraPDF, so it runs in the normal suite. The
 * veraPDF check stays the backstop; this is the fast guard in front of it.
 */

import { describe, expect, test } from 'vitest'

import { buildSiteReportPdf } from './document.js'
import { toBuffer } from '../build-site-report.js'
import {
  baselineSite,
  postInterventionSite
} from '../site-model.test-fixtures.js'

/**
 * @returns {Array<{ name: string, cids: number, glyphs: number }>} one entry per
 *   embedded font, as pdfkit will write it
 */
async function embeddedFonts(options) {
  const { doc } = await buildSiteReportPdf(options)
  await toBuffer(doc)
  return ['Body', 'Bold'].map((name) => ({
    name,
    cids: doc._fontFamilies[name].widths.length,
    glyphs: doc._fontFamilies[name].subset.glyphs.length
  }))
}

describe.each(['table', 'cards'])('%s layout font subsets', (layout) => {
  test('every glyph in the embedded subset has a CID', async () => {
    const fonts = await embeddedFonts({
      baseline: baselineSite(),
      postIntervention: postInterventionSite(),
      layout
    })

    // Equality, not "cids <= glyphs": a CID without a glyph would be just as
    // wrong, and pdfkit writes one bit per CID either way.
    for (const font of fonts) {
      expect(font, `${layout}/${font.name}`).toMatchObject({
        cids: font.glyphs
      })
    }
  })

  test('a habitat type containing a ligature pair does not break it', async () => {
    // "Modified" is the case that actually occurs. Spelled out rather than left
    // to the fixture, so the regression survives someone renaming the fixture.
    const baseline = baselineSite()
    baseline.layers.habitats[0].properties.type = 'Modified grassland'
    baseline.layers.habitats[1].properties.type = 'Traffic island'

    const fonts = await embeddedFonts({ baseline, layout })

    for (const font of fonts) {
      expect(font, `${layout}/${font.name}`).toMatchObject({
        cids: font.glyphs
      })
    }
  })
})
