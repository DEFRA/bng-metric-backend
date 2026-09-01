# The site report PDF

`GET /projects/{projectId}/report.pdf` renders a printable, screen-reader-structured
report for one project: the site drawn on a map with its habitat parcels over it, the
key figures, and one row per parcel carrying a thumbnail and the recorded attributes.

Delivered by BMD-984, from the spike on `spike/bmd-984-pdf-exports` in the harness.

## Where the numbers and the shapes come from

Two sources, deliberately:

|                                                           | Source                              | Why                                                                                                                                                                                                                                                  |
| --------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sizes, habitat types, conditions, unit totals             | the project JSONB document          | These are what the service shows on screen and what the unit calculation ran on. Recomputing them from the geometry would give the report a second opinion, and a report that disagrees with the page it was generated from is worse than no report. |
| Parcel, hedgerow, watercourse, tree and red-line geometry | the `bng.*_features` PostGIS tables | These are the copy the user has since **edited** through `PUT /projects/{id}/features/{featureId}`. The uploaded GeoPackage can be stale.                                                                                                            |

They are matched by `featureId`, which is the geometry row's own primary key (see
`geometryRowValues` in `src/services/upload/persist-upload.js`). A feature present in
one and not the other is dropped rather than guessed at.

The red line's **area** is the one number that comes from PostGIS rather than the
document (`ST_Area`), because the red line is a boundary, not a habitat, and carries no
`sizeSquareMetres`.

## Layout

| Path                                       | Role                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| `src/routes/report.js`                     | the route: visibility check, then the PDF bytes with a `content-disposition` |
| `src/services/report/build-site-report.js` | read → fetch tiles → draw, in that order                                     |
| `src/services/report/site-data.js`         | joins the document to the geometry                                           |
| `src/db/project-geometry.js`               | `ST_AsGeoJSON` reads, one layer at a time                                    |
| `src/services/report/pdf/projector.js`     | ground metres → page points. The piece worth reading first                   |
| `src/services/report/pdf/grid.js`          | tile matrix maths; WMTS capabilities parsing                                 |
| `src/services/report/pdf/map.js`           | tile and geometry drawing                                                    |
| `src/services/report/pdf/document.js`      | the tagged document: structure tree, tables, figures                         |
| `src/services/report/pdf/mvt.js`           | vector tiles, decoded into the shape `map.js` draws from                     |
| `src/services/os-tiles/`                   | the OS tiles service — the only code that knows the API key                  |
| `src/plugins/os-tiles.js`                  | the `/os-tiles` routes, and the tile cache, over that service                |

## What is delegated to libraries, and what is not

The report has a small runtime dependency list on purpose, but only where a library
genuinely removes work. What it delegates:

| Job                     | Library                                   | Why not ours                                                                                                                            |
| ----------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| PDF writing and tagging | `pdfkit`                                  | Structure tree, marked content, `/Alt`, `/Scope` and font embedding — the whole PDF/UA surface                                          |
| Vector tile decoding    | `@mapbox/vector-tile` over `pbf`          | The reference MVT implementation, and what MapLibre itself reads tiles with. `mvt.js` is now only the adapter to this repo's tile shape |
| Vector tile writing     | `@maplibre/vt-pbf` (test fixtures only)   | Nothing in production writes a tile; the fixtures do, so decode is proven by round-trip                                                 |
| Bounding boxes          | `@turf/bbox`                              | Walks every GeoJSON nesting depth, GeometryCollection included                                                                          |
| Tile caching            | `@hapi/catbox-memory`, via `server.cache` | Already in hapi's own dependency tree, and makes a future Redis cache a provisioning change rather than a code one                      |

And what it deliberately keeps:

- **`projector.js` and `grid.js`.** The ground-to-page transform and the EPSG:27700 tile
  matrix. `@mapbox/tilebelt` and friends are Web Mercator only, which is exactly the
  projection this report does not use. OpenLayers' `WMTSCapabilities` parser does produce
  an identical grid from OS's document — it was checked against ours — but it needs
  `DOMParser` and `Node` globals, so running it here means jsdom: ~55 MB of dependency to
  delete ~90 lines of parsing.
- **Areas and lengths.** Not computed at all — the project document carries them. Note
  that turf's measurement functions could not do it anyway: they are geodesic and assume
  WGS84 degrees, so on British National Grid metres `@turf/area` measures a 100 m square
  as 1.07e14 m². Only turf's bounding-box helpers are safe in this coordinate system.
- **The page layout in `summary-page.js` / `habitat-pages.js`.** `pdfmake` is declarative
  and built on pdfkit, but exposes no structure-tree API, so it cannot produce a tagged
  document.

## Four rules the code depends on

**1. Nothing is positioned except by `projector.toPage`.** Basemap tiles included. A map
tile is not an arbitrary picture — it covers an exact, known rectangle of ground — so a
tile corner and a habitat vertex are the same kind of thing: an EPSG:27700 coordinate.
Both go through the same call, which is why there is no nudge factor anywhere.
`registration.test.js` is the proof.

**2. All tile I/O completes before any drawing starts.** pdfkit's drawing is sequential
and stateful: the cursor, the current page and the open marked-content sequence all
depend on call order. An `await` in the middle lets other work interleave and silently
corrupts both the layout and the tagged reading order. The spike's first attempt
rendered completely blank rows for exactly this reason.

**3. A marked-content sequence is opened BEFORE anything is drawn into it.** Drawing
first and marking afterwards yields a `Figure` wrapping an empty sequence, with every
drawing operation left untagged — PDF/UA 7.1-3. It renders identically and reports alt
text throughout; only a conformance checker can see it.

**4. The OS tile grid is never hard-coded.** It comes from OS's own
`GetCapabilities`. A hard-coded origin one tile out produces a basemap that looks
plausible and is in the wrong place.

## Accessibility

The document targets **PDF/UA-1** and is verified with veraPDF, the reference
open-source validator, which runs from the `verapdf/cli` image (no JDK needed):

```bash
docker run --rm -v "$PWD:/data" verapdf/cli --format text --flavour ua1 /data/report.pdf
```

It tags `Document/Sect/H1/H2/P/Table/TR/TH/TD/Figure`, sets `/Alt` on every figure,
`/Scope` (and `/Headers`) on table cells, `Lang` `en-GB` and a document title, and
embeds its font programs — Noto Sans (SIL OFL 1.1), because pdfkit's default base-14
fonts are referenced by name and never embedded, which alone fails PDF/UA.

**Two things still outstanding:**

- **A screen-reader pass (NVDA) and PAC.** A veraPDF PASS is necessary, not sufficient:
  it confirms alt text _exists_, not that it reads well — it was perfectly happy with
  "1 watercourses", which a unit test now prevents. Roughly a third of PDF/UA's failure
  conditions are human judgement. **This is the go/no-go.**
- **GDS Transport instead of Noto Sans.** GOV.UK sets GDS Transport in the browser and
  that is what this should eventually embed. It is licensed for GOV.UK services but is
  not redistributable here, so swapping it in is a licensing step, not a code change:
  replace the two files in `src/services/report/assets/fonts` and the names in
  `document.js`.

## The basemap, and crediting it

The basemap is drawn whenever this service holds an `OS_API_KEY`. There is no separate
switch: the `/os-tiles` routes are not registered without a key, so the absence of a
credential shows up as the absence of a route rather than as an endpoint that always
401s, and a deployment with no key produces the same correct report on a plain ground.

### Two flavours, chosen per request

One key, two basemap sources, because Ordnance Survey grants API access
product-by-product and a key may hold either:

|                     | `?basemap=vector` (default)                                       | `?basemap=raster`                |
| ------------------- | ----------------------------------------------------------------- | -------------------------------- |
| OS Data Hub product | **OS NGD API – Tiles** (`ngd-base` tileset)                       | **OS Maps API**                  |
| What arrives        | Mapbox Vector Tiles, z0–15                                        | 256 px PNG rasters, z0–13        |
| Plan ceiling        | none observed — z0–15 all serve                                   | OpenData stops at z9 (see below) |
| In the PDF          | drawn as vector paths — crisp at any print size                   | placed as images                 |
| Styling             | `ngd-light-style.js`, machine-extracted from OS's published style | OS's, baked into the pixels      |
| Labels              | omitted (the report's tables carry the facts)                     | rendered by OS into the tile     |

The report route takes `GET /projects/{id}/report.pdf?basemap=vector|raster`, so the
two outputs can be compared like for like. Everything downstream of the tile source —
`pickZoom`, the projector, the document builder — is shared; `drawBasemap` dispatches
on the tile object itself (`{ png }` vs `{ layers }`). A flavour the key's products
cannot serve degrades to a plain ground like any other basemap failure, it does not
fail the report.

The vector flavour uses the NGD API rather than the older OS Vector Tile API because
OS have marked that product for retirement. Its style is not interpreted at runtime:
`npm run extract:ngd-style` distils OS's published `light-27700` GL style into
committed data (`src/services/report/pdf/ngd-light-style.js`), so builds and tests
need no network and a style revision arrives as a reviewable diff. One consequence of
NGD data worth knowing before judging output: at z12+ the tiles carry _surveyed
topography_ (kerbs, walls, fences as they exist on the ground), so urban edge lines
genuinely stop and start — that is the data, not a rendering fault.

**Every map drawn from OS tiles carries its credit in the bottom-right corner** — both
site maps, and every parcel thumbnail. A PDF cannot carry the dynamic credit control a
browser map uses, so the wording is part of the picture, on a translucent plate so it
reads over whatever mapping is underneath. The scale bar has the bottom left.

The credit is drawn as an artifact, so assistive technology skips it: the identical
string on fifty thumbnails would be fifty interruptions. The same wording is written
once as a tagged paragraph under the site maps (`buildAttribution` in `legend.js`),
which is where the reading order gets it.

**No OS mapping is drawn into a frame that cannot carry a credit.** `fitCredit` is
called before the tiles are fetched, and returning null is what withholds the basemap —
so the guarantee holds by construction rather than by every call site remembering to
pass the wording down. It is why blanking `OS_MAPS_ATTRIBUTION` and
`OS_MAPS_ATTRIBUTION_SHORT` produces a report with no OS mapping at all rather than
uncredited mapping.

`OS_MAPS_ATTRIBUTION_SHORT` exists because a parcel thumbnail is 18 mm square: the full
sentence cannot fit at any legible size, while `© Crown copyright` fits at 4.5 pt. Both
strings are **provisional** — the required wording is OS's to dictate and has not been
confirmed with them.

### What crediting does not settle

Attribution is one of the two licensing questions, and the smaller one.

**Nobody has asked OS whether we may EMBED their mapping in a downloadable PDF.** That
is a different question from displaying it in a browser, because a PDF can be forwarded,
and no amount of correct crediting answers it. It has to be asked directly. Until it is,
the lever is the key itself: no `OS_API_KEY` in an environment means no OS mapping in
any report that environment produces, and the report renders on a plain ground, which
needs no permission from anybody.

### Configuration

| Variable                    | Meaning                                                                                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OS_API_KEY`                | OS Data Hub key. Needs **OS NGD API – Tiles** for the vector flavour and/or **OS Maps API** for raster. A CDP secret per environment, not `cdp-app-config`. Absent → no `/os-tiles` routes, and no basemap. |
| `OS_MAPS_ATTRIBUTION`       | The credit burned into every map, and the tagged paragraph. Provisional wording.                                                                                                                            |
| `OS_MAPS_ATTRIBUTION_SHORT` | The credit used where the full wording will not fit legibly — thumbnails. Provisional wording.                                                                                                              |
| `OS_MAPS_LAYER`             | One of the EPSG:27700 raster styles. Default `Light_27700`.                                                                                                                                                 |
| `OS_MAPS_MAX_ZOOM`          | The **plan** ceiling — see below. Empty for Premium/PSGA.                                                                                                                                                   |

**The plan caps resolution on the RASTER flavour only, and no amount of engineering
changes it.** The vector flavour has shown no such ceiling. An OpenData-plan
key serves EPSG:27700 up to z9 (1.75 m/px) and returns `403 "A Premium Plan is required
to access Premium Data"` from z10 up, while `GetCapabilities` keeps succeeding — so the
failure presents as a tile problem rather than a licensing one. Premium/PSGA reaches z13
(0.109 m/px). Defra is a PSGA member, so the likely answer is an existing departmental
project rather than a new key.

`OS_MAPS_MAX_ZOOM` deliberately does **not** default to 9: defaulting to the free
ceiling would silently discard resolution a Premium key has paid for. `pickZoom` clamps
to whatever `/os-tiles/capabilities` publishes, so nothing that draws a map has to know
anything about OS plans — the same reasoning that keeps the key out of it.

Switching to EPSG:3857 does not escape the ceiling (~1.5 m/px at GB latitudes) and costs
exact registration, so it is not an option.

### Caching

The tile cache is hapi's own. `plugins/os-tiles.js` provisions a dedicated catbox client
(`@hapi/catbox-memory`, `maxByteSize` from `OS_MAPS_CACHE_MAX_BYTES`, TTL from
`OS_MAPS_CACHE_TTL_SECONDS`) and hands the resulting policy to the service, whose
`get`/`set` calls are catbox's own — so there is no cache implementation in this
repository to maintain. A dedicated client rather than the server's default cache, so
the tiles' byte budget is theirs alone and a busy report cannot evict whatever else the
service caches later.

It is measured in bytes rather than entries because that is what catbox counts, and it
suits tiles: a sparse rural tile is a couple of kilobytes and a dense urban vector one
is tens.

Process-local is a deliberate starting point. This service has no Redis — the frontend
has `ioredis` and `catbox-redis`, this side has neither — and per-instance caching
already collapses the repeats _within_ one report, which is where the bulk of the
duplication is (neighbouring parcels overlap). If cross-instance reuse turns out to
matter it is now a **provisioning** change rather than a code one: swap the provider for
`@hapi/catbox-redis` in `provisionTileCache`. NRF's
`nrf-frontend/src/server/common/services/tile-cache.js` is the shape to copy.

## Cost

Measured on a 50-parcel site read from real PostGIS, with no basemap: **184 kB, ~190 ms**.
Compute is not the constraint, so generating a report while the user waits is realistic.
With a basemap the cost becomes _network_ — roughly 30 tile fetches per site map, more
with parcel thumbnails — which is what to measure before ruling out a synchronous
response.

If report sizes ever grow past a few megabytes, streaming rather than buffering is the
change to make (`toBuffer` in `build-site-report.js`); buffering buys a definite
`content-length`, which is what lets a browser show download progress.
