/**
 * A small site model, shaped exactly as `site-data.js` produces one.
 *
 * Two overlapping-in-context parcels, a hedgerow, a watercourse, a tree and a
 * red line around the lot, in real EPSG:27700 metres. Small enough to read,
 * complete enough that every drawing and tagging path in the document runs.
 */

const RED_LINE = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [412000, 287000],
        [412400, 287000],
        [412400, 287300],
        [412000, 287300],
        [412000, 287000]
      ]
    ]
  ]
}

function parcel(minX, minY, maxX, maxY) {
  return {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [minX, minY],
          [maxX, minY],
          [maxX, maxY],
          [minX, maxY],
          [minX, minY]
        ]
      ]
    ]
  }
}

function baselineSite(overrides = {}) {
  return {
    siteName: 'Test Farm',
    units: {
      habitatsTotal: 12.5,
      treesTotal: 0.5,
      hedgerowsTotal: 2,
      watercoursesTotal: 1
    },
    redLine: { geometry: RED_LINE },
    redLineAreaSqm: 120_000,
    layers: {
      habitats: [
        {
          properties: {
            ref: 'A1',
            type: 'Modified grassland',
            condition: 'Poor',
            sizeSquareMetres: 60_000,
            sizeMetres: null
          },
          geometry: parcel(412000, 287000, 412200, 287300)
        },
        {
          properties: {
            ref: 'A2',
            type: 'Cereal crops',
            condition: 'Moderate',
            sizeSquareMetres: 60_000,
            sizeMetres: null
          },
          geometry: parcel(412200, 287000, 412400, 287300)
        }
      ],
      hedgerows: [
        {
          properties: {
            ref: 'H1',
            type: 'Native hedgerow',
            condition: 'Good',
            sizeSquareMetres: null,
            sizeMetres: 300
          },
          geometry: {
            type: 'MultiLineString',
            coordinates: [
              [
                [412000, 287300],
                [412400, 287300]
              ]
            ]
          }
        }
      ],
      watercourses: [
        {
          properties: {
            ref: 'W1',
            type: 'Ditches',
            condition: 'Moderate',
            sizeSquareMetres: null,
            sizeMetres: 300
          },
          geometry: {
            type: 'MultiLineString',
            coordinates: [
              [
                [412000, 287150],
                [412400, 287150]
              ]
            ]
          }
        }
      ],
      trees: [
        {
          properties: {
            ref: 'T1',
            type: 'Urban tree',
            condition: 'Good',
            sizeSquareMetres: null,
            sizeMetres: null
          },
          geometry: { type: 'MultiPoint', coordinates: [[412100, 287100]] }
        }
      ]
    },
    ...overrides
  }
}

/**
 * The post-intervention side: the same ground, with A2 becoming something
 * better, which is what the report is for.
 */
function postInterventionSite() {
  const site = baselineSite()
  site.layers.habitats[1].properties.type = 'Other neutral grassland'
  site.layers.habitats[1].properties.condition = 'Good'
  site.units = {
    habitatsTotal: 18.5,
    treesTotal: 0.5,
    hedgerowsTotal: 2,
    watercoursesTotal: 1
  }
  return site
}

export { RED_LINE, baselineSite, parcel, postInterventionSite }
