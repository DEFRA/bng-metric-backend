# Reference data

## england.geojson

Used by `redline-in-england` to test whether an uploaded baseline's red line
boundary lies entirely within England.

**Source:** ONS "Countries (December 2024) Boundaries UK BUC" dataset, England
feature only (`CTRY24CD = E92000001`), already published in EPSG:4326. BUC
("British Ultra Coarse") precision is appropriate for our `booleanWithin`
topology check — it includes Scilly, the Isle of Wight, Holy Island and other
offshore islands.

To refresh, download the latest "Countries Boundaries UK BUC" file from the
ONS Open Geography Portal and re-run:

```sh
jq '.features[] | select(.properties.CTRY24NM == "England") | {
  type: "Feature",
  properties: {
    name: "England",
    source: "ONS Countries (...) Boundaries UK BUC",
    code: .properties.CTRY24CD,
    crs: "EPSG:4326"
  },
  geometry: .geometry
}' <source.geojson> > england.geojson
```

The file format is a GeoJSON `Feature` whose geometry is a `Polygon` or
`MultiPolygon` in WGS84 (EPSG:4326), longitude/latitude order.

https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Countries_December_2024_Boundaries_UK_BUC/FeatureServer
