import { describe, expect, test } from 'vitest'

import { addKeyFiguresTable } from './key-figures.js'

/** A pdfkit document stand-in that keeps the rows the table was given. */
function recordingDoc() {
  const doc = {
    rows: null,
    font: () => doc,
    fontSize: () => doc,
    fillColor: () => doc,
    table: ({ data }) => {
      doc.rows = data.map((row) => row.map((cell) => cell.text.trim()))
      return doc
    }
  }
  return doc
}

function site(layers, units = {}) {
  return {
    layers: {
      habitats: [],
      verticalHabitats: [],
      hedgerows: [],
      watercourses: [],
      trees: [],
      ...layers
    },
    units
  }
}

const feature = (properties) => ({ properties })

describe('addKeyFiguresTable', () => {
  test('gives vertical area habitats a row of their own, sized in square metres', () => {
    const doc = recordingDoc()
    const baseline = site(
      {
        habitats: [feature({ sizeSquareMetres: 10_000 })],
        verticalHabitats: [
          feature({ sizeSquareMetres: 40 }),
          feature({ sizeSquareMetres: 12.4 })
        ]
      },
      { habitatsTotal: 2.5 }
    )

    addKeyFiguresTable(doc, null, baseline, null)

    expect(doc.rows).toEqual([
      ['Measure', 'Baseline', 'Post-intervention'],
      ['Area habitats', '1 parcels, 1.00 ha', 'Not supplied'],
      ['Vertical area habitats', '2 features (52 m²)', 'Not supplied'],
      ['Hedgerows', 'None', 'Not supplied'],
      ['Watercourses', 'None', 'Not supplied'],
      ['Individual trees', 'None', 'Not supplied'],
      ['Biodiversity units', '2.50 units', 'Not supplied']
    ])
  })
})
