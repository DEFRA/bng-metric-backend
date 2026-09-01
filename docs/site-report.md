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
  that is what this should eventually embed. The code is ready for it — see
  [The typeface, and where it comes from](#the-typeface-and-where-it-comes-from) — and
  what remains is a licensing answer, not a change.

## Two habitat layouts

Page 2 onwards presents the parcels one of two ways, chosen with
`?layout=table|cards`. Same data, same mini-map, different shape.

|                  | `table` (default)                  | `cards`                                     |
| ---------------- | ---------------------------------- | ------------------------------------------- |
| Shape            | One row per parcel, five columns   | One card per parcel, one line per attribute |
| Attributes shown | Ref, habitat type, condition, size | Those plus twelve more — see below          |
| Mini-map         | 52 pt square                       | 96 pt square                                |
| Parcels per page | More                               | Fewer                                       |
| Structure        | `Table` / `TR` / `TH` / `TD`       | `Sect` / `H3` / `P`, one `Figure` per card  |

**Why cards exist.** A table's attribute count is bounded by the width of the page —
five columns already leaves "Modified grassland" wrapping in a 90-point cell, and the
project document holds a good deal more than four useful facts per parcel. A card turns
that ninety degrees.

**It also sidesteps the `/Headers` gap.** The table is hand-laid, because a `doc.table()`
cell cannot hold a drawing and pdfkit only emits `/Headers` inside `doc.table()`. Its cells
therefore carry `/Scope` and nothing links a value back to the header describing it. A card
has no columns to associate: each line is a paragraph reading "Condition: Poor", which
needs no table navigation at all. If the NVDA pass finds the table hard to move around,
this is the answer that already exists.

### What a card shows

Sixteen fields, in reading order: what the parcel **is**, then how it is **judged**, then
how the number was **arrived at**, then what was **recorded** about it on the ground.

| Group        | Fields                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------- |
| Identity     | Ref and habitat type (the card heading), broad habitat                                          |
| Judgement    | Condition, distinctiveness, strategic significance, retention, spatial risk, size               |
| The workings | Creation difficulty, time to target, advance or delay, final time to target, biodiversity units |
| Recorded     | Calculation status, survey date, survey details, comment                                        |

Three conventions, all of them borrowed from the service's own habitat detail screens so
the report and the page it was generated from do not describe the same parcel differently:

- **A band and its score share a line** — "Low (2)", not two lines. Same for condition and
  for creation difficulty and its multiplier.
- **A retention category is normalised.** The backend strips the GeoPackage's `1. ` list
  prefix when it decides which calculation to run but never writes the normalised value
  back, so the document keeps whatever the upload carried. The report strips it again.
- **A bare number of years is worded** — "10 years", not "10". The engine writes its two
  time fields in different shapes, and only a real upload shows it:
  `standardTimeToTargetCondition` arrives as the numeric **string** `"10"`, while
  `finalTimeToTargetCondition` arrives already phrased as `"10 years (0.7002822742)"`. So
  the test is "does it parse as a number", not "is it a number" — a numeric string needs
  the unit just as much. Anything already worded fails the parse and passes through.

Two things the report deliberately does **not** tidy, because the service does not either
and a report that disagrees with the screen it came from is worse than one that repeats
its warts: `finalTimeToTargetCondition` carries the time multiplier at full precision
("3 years (0.898632125)"), and the engine writes "1 years" for a single year. Both are
worth fixing at source rather than in the report.

**The workings group is post-intervention only.** A baseline parcel is not being created
or enhanced, so it has no difficulty, no time to target and nothing to advance or delay.
Its card is simply shorter — which is the general rule: cards are sized from their
content, and an unrecorded attribute is omitted rather than printed blank. An empty row
invites the reader to wonder what is missing; a shorter card simply says less.

**Two fields wrap.** Survey details and comment are free text of unbounded length, so
their height is _measured_ rather than counted — `heightOfString`, at the same width, size
and face the renderer will use. They sit last on the card on purpose: an unbounded field
in the middle would push the fixed ones around from card to card, and a reader comparing
two parcels would lose the ability to find the same fact in the same place on both.

Two measurement traps came out of building it, both invisible to any test that counts
lines and both visible on the page:

- **Measure in the face you draw in.** Values are drawn bold, and bold is the wider face.
  Measuring the wrap in the regular face reports fewer lines than the renderer goes on to
  draw, and the overflow lands outside the card's own border.
- **Size the label column from the labels.** "Strategic significance:" needs 94 pt of the
  96 pt a fixed constant gave it. A label that overflows wraps to a second line, but a
  non-wrapping field advances by exactly one line height — so the wrapped label would be
  drawn straight through the row beneath it. The column is now measured from the widest
  label plus a gutter, which matters because [the typeface is a deployment
  option](#the-typeface-and-where-it-comes-from): a face a shade wider than Noto Sans would have started overlapping rows
  with every test still green.

Both layouts pass PDF/UA-1.

### One bug this surfaced: ligatures and `/CIDSet`

Adding the card layout made the report fail veraPDF on a rule that had nothing to do with
cards — `7.21.4.2-2`, "a CIDSet shall identify all CIDs present in the font program".

pdfkit builds `/CIDSet` from its own width table, but fontkit's subsetter also pulls in the
**component glyphs of any composite glyph**. Noto Sans Bold's `fi` is a composite ligature,
so its component landed in the embedded font program without pdfkit ever assigning it a
CID, and the CIDSet came out one glyph short. The document rendered perfectly.

The trigger was the word **"Modified"** — as in _Modified grassland_, one of the commonest
UKHab types. The table layout escaped it only because it sets no user data in bold, and
Noto Sans Regular's `fi` is not composite. That is luck, not design, and it would not
survive swapping the typeface.

The fix is `dataText()` in `page-furniture.js`: ligatures off for user-supplied text, which
is the text whose characters we cannot predict. Both layouts use it. `cidset.test.js`
asserts the invariant directly — every glyph in an embedded subset has a CID — so the whole
class is caught in the normal test suite without needing veraPDF.

## The typeface, and where it comes from

PDF/UA requires every font PROGRAM to be embedded, so a report always carries a subset
of whatever it was drawn with, and that subset travels to everyone the document is
forwarded to. Which typeface it is, then, is a licensing question before it is a
typographic one.

Two sources, chosen by `REPORT_FONT_BUCKET`:

| Unset (the default)                                                 | Set                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------- |
| The Noto Sans files committed in `src/services/report/assets/fonts` | Two objects fetched from a private S3 bucket at startup |
| SIL OFL 1.1, so safe to hold in a public repository                 | For a typeface this repository is not allowed to hold   |

**Why a bucket rather than two more committed files.** GDS Transport is licensed to GDS
under a bilateral agreement with its designers; its own name table records the licence as
"Contact Margaret Calvert and Henrik Kubel … Special license agreement" and the font as
"customised exclusively for the UK Government Digital Services … not commercially
available". `DEFRA/bng-metric-backend` is a **public** repository, so committing the files
would publish the font to anyone who clones. A private bucket separates the two exposures:

| Exposure                                      | Fixed by a private bucket?                                                                                                                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The font file in every clone of a public repo | **Yes.** This is the one the licence does not permit                                                                                                                                          |
| A subset inside every generated report        | **No, and nothing can** — that is what embedding is. It is also the sanctioned case: the font's `fsType` bit is _Preview & Print embedding_, which is the rights holder allowing exactly this |

That does not answer whether GDS permit it; it makes the question a reasonable one to ask,
and holding the font privately is the precondition for asking it. **Ask before enabling.**

### What was verified

Against `govuk-frontend@6.4.0`, which ships GDS Transport as WOFF and WOFF2:

| Check                            | Result                                                              |
| -------------------------------- | ------------------------------------------------------------------- |
| pdfkit can embed it              | **Yes** — fontkit reads WOFF and WOFF2 directly, no conversion step |
| PDF/UA-1 under veraPDF           | **PASS**, on the full 20-parcel report                              |
| Glyph coverage for this document | Complete — nothing missing, including `²` and `£`                   |
| Output size                      | 221.9 kB, slightly **smaller** than the same report in Noto Sans    |
| Embedding permission (`fsType`)  | Preview & Print — embedding allowed                                 |

One defect to fix on the way in: govuk-frontend blanks the font's name table for web
delivery, so pdfkit emits `/BaseFont /CZZZZZ+` with no name after the subset prefix.
Injecting a name table before upload gives `/CZZZZZ+GDSTransportWebsite-Light`, and it
still passes. Do that once, to the objects that go in the bucket — not at runtime.

### Configuration

| Variable                  | Default                         | Meaning                                                        |
| ------------------------- | ------------------------------- | -------------------------------------------------------------- |
| `REPORT_FONT_BUCKET`      | _(empty)_                       | Bucket holding the fonts. Empty embeds the committed Noto Sans |
| `REPORT_FONT_REGULAR_KEY` | `GDSTransportWebsite-Light.ttf` | Regular-weight object key                                      |
| `REPORT_FONT_BOLD_KEY`    | `GDSTransportWebsite-Bold.ttf`  | Bold-weight object key                                         |
| `REPORT_FONT_TIMEOUT_MS`  | `10000`                         | Per-object timeout for the startup fetch                       |
| `REPORT_FONT_MAX_BYTES`   | `5242880`                       | Size ceiling per object                                        |

Credentials come from the SDK's default provider chain — IAM in CDP, `S3_ENDPOINT` against
LocalStack in development, where `compose/start-localstack.sh` creates an empty
`bng-metric-report-fonts` bucket to copy a licensed font into.

### Loaded once, at boot

`plugins/report-fonts.js` resolves the fonts during `createServer()` and hangs them on
`server.app.reportFonts`; the route passes them to the builder. Never per request, for
three reasons in ascending order of how much they would hurt:

1. `registerFonts` is synchronous **by design**. All I/O completes before any drawing
   starts, because pdfkit's drawing is sequential and stateful and an `await` in the middle
   of it silently corrupts both layout and the tagged reading order — see
   [Four rules the code depends on](#four-rules-the-code-depends-on). An await inside
   document construction is precisely that bug.
2. It would add a failure mode to a path that cannot currently fail.
3. A font is build-time-static data. Fetching it per request buys nothing.

The bytes are checked as they arrive — size, and the leading four bytes against the font
container signatures — because S3 will serve a README under a `.ttf` key perfectly happily,
and pdfkit would otherwise only discover that inside the first request.

### When the bucket cannot be read

It **degrades to the committed Noto Sans and warns**; it does not fail the boot. Same
choice the basemap makes, for the same reason: a report in the fallback typeface is still
correct, complete and accessible, so a bucket outage should not become a report outage.

That choice has a cost worth stating, because it is not visible in the output. A missing
basemap is _visibly_ missing; a substituted typeface just reads as a design decision. So
the warning is the only signal an operator gets, and it is built to be one — logged at
`warn` so it survives a production log level, and naming the bucket, the reason and the
consequence:

```
Report fonts could not be read from s3://bng-metric-report-fonts: The specified key does
not exist. Falling back to the bundled NotoSans-Regular.ttf / NotoSans-Bold.ttf: reports
will render in Noto Sans, not the typeface s3://bng-metric-report-fonts was configured to
supply.
```

**Alert on that line** in any environment where the bucket is set. It fires once per
instance start, and it is the difference between finding out at deploy time and finding out
when somebody notices the letterforms.

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
