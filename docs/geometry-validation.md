# Geometry validation

Uploaded GeoPackages are checked against fifteen geometry rules — the redline
must be valid, inside England and under 100 km²; parcels must not overlap, must
not escape the redline, must not be under a square metre; hedgerows,
watercourses, IGGIs and trees must sit inside the boundary; the parcels must sum
to the redline.

All fifteen run **in this process**, on a worker thread, with GEOS compiled to
WebAssembly. Validation takes **no database connection at all**.

## Why it works this way

Validation used to be a single large PostGIS statement, and it rationed itself on
database connections — a resource shared with every login and page load, and one
the service cannot scale on its own. With a light pooled-query probe running
alongside, against the same `max: 10` pool the app uses:

|                                     | Probe requests served in 12 s | Connection acquire p50 |
| ----------------------------------- | ----------------------------: | ---------------------: |
| Idle                                |                       ~73,000 |                   0 ms |
| 12 concurrent no-op loops (control) |                       ~98,000 |                   0 ms |
| 12 concurrent validations, PostGIS  |                         **1** |          **18,162 ms** |
| 12 concurrent validations, GEOS     |                      ~116,000 |                   0 ms |

Read the GEOS row against the _control_, not against idle: twelve pending async
loops raise the probe rate above idle on their own, because the event loop polls
harder when it has work. The honest statement is that validation load became
**indistinguishable from no validation at all**, where before it collapsed the
service to a single served request with an eighteen-second wait for a
connection.

GEOS is also the library PostGIS calls, so this was never a reimplementation of
the geometry — it is the same geometry, reached without a round trip to something
the service cannot add more of. Reproduce any of this with
`node scripts/bench-geometry-validation.mjs <fixture-dir>` (the PostGIS arm of
the comparison was taken before that engine was deleted — see the script header).

## How the old engine's correctness was kept

The PostGIS statement is gone. Its **answers** are not.

- `integration-tests/fixtures/postgis-geometry-verdicts.json` records the verdict
  that engine gave for all 98 readable GeoPackages in the harness's
  `example-files/` — the valid ones, the deliberately broken ones, the five real
  BNG-500 submissions and the whole BMD-934 permutations catalogue.
  `geometry-verdict-regression.test.js` replays every one of them through the
  real worker pool and asserts the verdict, payload and message still match.
  Nobody designed those files to agree with anything, which is what makes them
  worth more than fixtures written alongside the code they test.
- `integration-tests/geometry-validate-baseline-layers.test.js` is the
  rule-by-rule spec. It was **written against the PostGIS engine** and its
  fixtures and thresholds are unchanged; it was simply pointed at the new engine.
  Around forty assertions covering tolerance boundaries, invalid-parcel overlaps,
  coordinate systems and the details payloads.
- `error-builders.js` — the module that turns a payload into the sentence a user
  reads — is untouched from when the SQL produced those payloads. Keeping the
  payload shape is what keeps the wording identical, and it is why `payloads.js`
  documents field names, ordering and the 50-row cap as a contract.

The one known difference is cosmetic: the two libraries can start an identical
ring at a different vertex, so a WKT string in the tail of a message may read
`POLYGON((529830 180170,…))` where PostGIS wrote `POLYGON((529870 180170,…))`.
Same triangle, same area, same verdict. The regression suite normalises ring
rotation and relaxes nothing else — digits, punctuation and vertex order all
still have to match, because `postgisWkt()` in `geos-runtime.js` reconciles the
two libraries' formatting conventions.

## The worker pool

GEOS is synchronous C code, and running it inline freezes the process. Measured
on a 5,000-parcel file by sampling how late a 10 ms interval actually fires:

|                                |  Duration | Loop lag p50 | Loop lag max | Timer ticks |
| ------------------------------ | --------: | -----------: | -----------: | ----------: |
| PostGIS (awaited query)        | 13,532 ms |       1.3 ms |       126 ms |       1,173 |
| GEOS inline on the main thread |    694 ms |       1.2 ms |   **684 ms** |       **4** |
| GEOS on a worker thread        |    756 ms |       1.0 ms |        18 ms |          70 |

Four timer ticks in 694 ms is the whole story: run inline, the loop gets almost
no turns and the process serves nothing else for the duration. Worker threads are
a precondition here, not an optimisation.

| Setting                               | Default | What it is                                                           |
| ------------------------------------- | ------: | -------------------------------------------------------------------- |
| `VALIDATION_WORKER_COUNT`             |       2 | Workers, capped at `availableParallelism() - 1`.                     |
| `VALIDATION_WORKER_QUEUE_LIMIT`       |       8 | Validations allowed to wait for a free worker. Not free — see below. |
| `VALIDATION_WORKER_TIMEOUT_MS`        |   10000 | Per-job budget; on overrun the worker is terminated.                 |
| `VALIDATION_QUEUE_WAIT_LIMIT_MS`      |    5000 | Longest a job may WAIT to start before it is refused instead.        |
| `VALIDATION_PARSE_BUDGET_BYTES`       |  400 MB | Heap rationed across the files being PARSED at once. See below.      |
| `VALIDATION_BUSY_RETRY_AFTER_SECONDS` |       5 | `Retry-After` on the 503. The frontend honours this.                 |

The pool cap is **half** the admission control: it rations CPU, which is the
same protective bounding the connection pool used to provide, except on a
resource CDP can add more of. It does not ration memory, and memory is what a
burst of large files actually exhausts — hence the parse budget below, which
refuses on size before the file is opened.

### Being busy is a poll, not a failure

There is no fallback, so saturation has to be handled rather than absorbed. The
design makes the browser the queue:

1. The route asks the pool `hasCapacity()` **before** streaming the file out of
   S3. Refusing after a 100 MB download would make a refusal expensive, and the
   whole scheme depends on refusals being cheap enough to retry every few
   seconds.
2. A refusal is a **503 `VALIDATION_BUSY`**.
3. The frontend keeps the user on the "Checking your file" page, whose existing
   `<meta http-equiv="refresh">` retries. **How soon comes from the 503's
   `Retry-After`** — the backend is the side that knows how loaded it is, so the
   pace is decided in one place rather than duplicated. The frontend treats it as
   a hint, ignoring anything unparseable or outside 1–30 s, and adds its own
   jitter on top so waiting browsers do not all return on the same tick: a small
   fixed pool seeing a burst every five seconds and idling in between is the
   worst possible arrival pattern for it.
4. After `MAX_WAIT_SECONDS` (120 s) the frontend gives up and says so. A service
   that has been saturated for two minutes will not be free in another five.

Two properties follow. **Only `busy` is retried** — a 500 or a timeout is not,
because a pathological file that wedges a worker would otherwise be re-fed to the
pool twenty-four times. And **the wait is bounded at both ends**: `hasCapacity()`
stops a request joining a hopeless queue, while `VALIDATION_QUEUE_WAIT_LIMIT_MS`
refuses a job that has already waited too long by the time a worker frees up.
Without the second, the worst case is `queueLimit x workerTimeoutMs` — 80
seconds, long past any client's patience, and spent on work nobody is waiting for.

What this does **not** give you is fairness. Retries are a lottery, not FIFO, so
under sustained load an unlucky user can lose repeatedly and hit the 120 s bound
while others get through. A server-side job queue would preserve arrival order;
that is the main reason to reach for one if this ever proves insufficient.

### What happens when the pool cannot cope

There is **no fallback**. The PostGIS path does not exist to fall back to, and
that is deliberate: a fallback would mean the same file getting a different
answer depending on how busy the box was, and it would quietly push load back
onto the database the moment capacity got tight — which is the problem this
replaced.

Instead the two failure modes are told apart, because the user's next action
differs:

| Condition                   | Response                                                | Why                                                                                                     |
| --------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Queue full                  | **503** + `Retry-After`, body carries `VALIDATION_BUSY` | The file was never looked at. Nothing is wrong with it and there is nothing to fix — come back shortly. |
| Timeout, crash, worker gone | **500** `VALIDATION_FAILED`                             | Something went wrong looking at this file. Retrying will most likely do the same thing.                 |

`VALIDATION_BUSY` is deliberately **not** a validation error. The frontend picks
the 503 out in `services/baseline.js`, returns `{ busy: true }`, and the upload
controller sends the user back to the upload page with "The service is busy
checking other files. Please try again in a few moments." — the same treatment an
upload timeout already gets. It must never reach `/error-file`, which is the
"there is a problem with your file" screen.

`GeoPackageValidationBusy` counts these. A non-zero rate is a capacity signal:
the levers are `VALIDATION_WORKER_COUNT` (if the task has the memory) or more
backend instances.

### The timeout ladder

Every layer has to sit strictly inside the one outside it, or a failure surfaces
as a dropped connection rather than as an error anyone can act on. It previously
did not: the backend was willing to spend ~91 s (30 s waiting for the uploader,
30 s downloading, 30 s validating) inside a frontend budget of 10 s.

| Layer                           | Setting                          |                  Budget |
| ------------------------------- | -------------------------------- | ----------------------: |
| CDP ingress / load balancer     | _platform_                       | **unknown — see below** |
| Frontend validate call          | `BACKEND_VALIDATE_TIMEOUT_MS`    |                    25 s |
| Wait for CDP Uploader ready     | `UPLOAD_READY_TIMEOUT_MS`        |                     3 s |
| Stream the file out of S3       | `UPLOAD_DOWNLOAD_TIMEOUT_MS`     |                    10 s |
| Wait for a free worker          | `VALIDATION_QUEUE_WAIT_LIMIT_MS` |                     5 s |
| Run the validation              | `VALIDATION_WORKER_TIMEOUT_MS`   |                    10 s |
| Parse, extract, enrich, persist | _unbounded_                      |         ~1.2 s measured |

The frontend budget is **per-request**, not the global `BACKEND_TIMEOUT_MS` — that
stays at 10 s, because a hung project list or login should fail fast rather than
hold a page for half a minute. Validation is the only call that legitimately
takes seconds.

> **25 s is a guess, and deliberately a conservative one.** The real ceiling is
> the CDP ingress idle timeout, which is not in either repo. 25 s is safe under
> either a 30 s or a 60 s ingress. Once that number is known, raise
> `BACKEND_VALIDATE_TIMEOUT_MS` toward it and widen the download and worker rungs
> to match — that is what governs the largest file this synchronous pipeline can
> accept.

### Memory is why the pool is small

WebAssembly linear memory grows to the high-water mark of the work done and is
never handed back, so a worker that has validated one large file keeps that
footprint for the rest of its life. Worker threads live in the SAME process as
the server, so this counts against the same container limit — it is not budget
that sits somewhere else.

Measured on a 5,000-parcel fixture, as whole-process RSS:

|                                        |                               RSS |
| -------------------------------------- | --------------------------------: |
| Server modules loaded, no workers      |                             58 MB |
| 1 worker, after one validation         |                            233 MB |
| 2 workers, after one validation each   |                            339 MB |
| 2 workers, after five validations each | **565 MB** (flat from the fourth) |

So roughly **250 MB per worker**, plateauing rather than leaking. Two properties
follow, and both are easy to get wrong:

- **It is the LARGEST file a worker has ever seen that sets its footprint, not
  the average.** Most real submissions are tens of features and would settle far
  lower — but one 5,000-parcel upload pins that worker at ~250 MB permanently.
  Size the pool for the worst file you accept, not the typical one.
- **Recycling workers would not reclaim it.** Killing a worker and starting a
  fresh one does not return the memory to the OS; the replacement reuses the
  pages. Measured over six kill-and-restart cycles, RSS settles at ~279 MB and
  stops climbing — so the timeout and crash paths are safe, but there is no point
  building a "restart every N jobs" mechanism, because it would buy nothing.

**Check the ECS task memory limit before raising `VALIDATION_WORKER_COUNT`.** The
default of 2 wants roughly 565 MB of headroom on top of Node's own baseline and
the parsed layers in-flight uploads hold. At a 2 GB task that is comfortable; at
1 GB it is one worker at most.

### What a deep queue costs

The queue holds job objects — an id, a file path, two callbacks — so the array
itself is a couple of kilobytes at the default limit and can be ignored. What
cannot be ignored is what each _waiting request_ holds elsewhere.

**This was true until the read was reordered, and is kept here because the
reasoning still explains the shape of the cost.** A queued validation used to
sit inside `validateGeoPackageLayers` still holding the parsed GeoPackage the
format gate produced, so a deep queue was a deep pile of object graphs. Measured
on the perf fixtures, eight queued uploads held **278 MB** (5,000 parcels) or
**514 MB** (12,000 parcels).

The gate no longer unpacks. It answers valid/invalid from the file and the
shapes are read on the far side of the pool wait, so the same eight queued
uploads now hold **11 MB** and **53 MB** respectively — a queued request holds a
path, not a heap. `VALIDATION_WORKER_QUEUE_LIMIT` is therefore close to free
again, which is what it always looked like and never was.

Unlike the workers' WebAssembly heap this memory is **transient** — garbage once
the request ends, not a high-water mark. Before the reorder, raising
`VALIDATION_WORKER_QUEUE_LIMIT` raised the memory ceiling directly and lowering
it was the best lever a memory-tight task had. That is no longer the trade: the
queue now costs a path per waiting request, so the limit rations CPU, which is
what it was always meant to ration.

### Refusing on size, before the read

The section above describes a ceiling nothing enforced. The order of work was
the wrong way round. The route does ask the pool `hasCapacity()` before doing
anything, but that answer is **advisory**; the refusal that actually sticks is
raised inside the pool, and `validateAndReadGpkgFile` runs before it. So a
request that lost the race had already parsed its own copy of every feature in
the file — and held it until the response was sent. Twenty concurrent 5,000-parcel
uploads therefore pinned their parsed layers no matter what
`VALIDATION_WORKER_QUEUE_LIMIT` said, because the queue limit counts requests
waiting for a worker and every one of them is already holding its layers. On
Fargate, with no swap to absorb the peak, that is an OOM kill rather than a slow
patch: the task dies and takes every in-flight upload with it.

The fix is to decide from the **file size**, which the uploader reports before
the file is opened. `parse-budget.js` holds a process-wide byte budget; the
route reserves an estimated parse cost against it before downloading, and
releases it once the response is built. A file that does not fit gets the same
503 + `Retry-After` a full queue gives, having cost nothing.

The estimate is **8 MB fixed + 14x the file size**, from measuring RSS either
side of a parse of each perf fixture:

| Fixture        | File size | Parse cost |
| -------------- | --------: | ---------: |
| 80 parcels     |    140 KB |       6 MB |
| 800 parcels    |    704 KB |      16 MB |
| 5,000 parcels  |    4.0 MB |      48 MB |
| 12,000 parcels |    9.5 MB |     131 MB |

(Higher than the ~29 MB quoted above for the same fixture because that figure is
V8 heap and these are whole-process RSS — the native allocations better-sqlite3
makes do not show up in the heap number, and they are just as real against the
task limit.) The ratio is rounded **up** from the steepest measured value, 13.3:
an estimate that comes in low admits a file the process cannot afford, which is
the failure this exists to prevent, while one that comes in high only costs
throughput and says so in the metric.

At the 400 MB default that admits roughly six 5,000-parcel files or three
12,000-parcel ones at once. Raise it **with** the task memory limit, not on its
own: the process also needs its warm baseline (~450 MB after sustained work) and
one worker's copy of the largest file it is validating.

Two properties are deliberate:

- **The first file in is always admitted, however big it is.** With nothing else
  in flight there is no one to wait for, so refusing would mean that file could
  never be validated at all — a permanent failure dressed as back-pressure. The
  worker timeout is what catches a file genuinely too big to handle.
- **The check before the download is advisory; the reservation re-checks.**
  Another request can take the last of the budget while this one is streaming
  its file out of S3, so the reservation can still refuse — and answers with the
  same 503 rather than an error. Exactly the contract `hasCapacity()` already
  has with the pool.

It counts reservations rather than sampling RSS on purpose. RSS lags, and it
never falls back to where it started — V8 keeps its heap reserved and glibc
keeps its arenas — so a limit read off RSS would tighten as the process ages and
refuse bursts in the afternoon it served in the morning. What admission control
needs to know is how much work is in flight _right now_, and the route is the
one thing that knows it exactly.

### The gate does not unpack, and why the file is read twice

The order used to be: unpack everything, then ask the pool. That put the most
expensive thing the handler does in front of the cheapest decision it makes.

It is now: gate without unpacking, wait for a worker, then unpack. A structurally
broken file is still rejected before it costs a worker slot — which is why the
check was in front of the queue in the first place — but a file that passes
carries a path into the queue rather than its shapes.

The cost is a **second read of the same file**, which BMD-910 had deliberately
removed by having the gate hand back the layers from its own pass. That decision
was right when the alternative was two full unpacks; it is wrong when the
alternative is holding one unpack for the length of a queue wait. The second read
re-fetches the rows — about 14 ms on the 5,000-parcel fixture — and buys not
holding 57 MB per waiting request. Memory was the scarcer resource.

`validateGeoPackageLayers` therefore accepts a LOADER as well as layers. Handed a
function, it calls it after the pool answers. Callers that already have layers in
hand and are not queueing behind anything can still pass them directly.

### Why the worker is given a file path, not the layers

Posting parsed layers across the thread boundary would mean a structured clone of
that ~29 MB object graph per upload, and would leave the synchronous
better-sqlite3 parse on the main thread — the very thing worth moving. The worker
takes the path of the file `downloadFileToTemp` has already put on local disk and
parses it itself. That costs a second parse (57 ms at 5,000 parcels) and saves
the whole validation.

`filePath` therefore has to be threaded from the route to
`validateGeoPackageLayers`, which throws without one rather than silently
skipping the geometry checks.

## What to watch

Three questions, and the metric that answers each.

**Is it keeping up?** These are the leading indicators — they move before anyone
is turned away.

| Metric                        | Meaning                                                                    |
| ----------------------------- | -------------------------------------------------------------------------- |
| `UploadValidationQueueWaitMs` | Time spent waiting for a free worker. Climbing = too few workers.          |
| `ValidationWorkerQueueDepth`  | Validations queued, sampled as each is served.                             |
| `UploadPostgisValidateMs`     | Time spent actually validating. Climbing = bigger files, not more of them. |

Wait and work are separated on purpose: they look identical in a total, and they
have opposite remedies. (`UploadPostgisValidateMs` keeps its name for dashboard
continuity across the engine change — see `metric-names.js`.)

**Is it turning people away?** `GeoPackageValidationBusy`, sliced by `reason`:

| `reason`        | Means                                                          | Remedy                                                                                                   |
| --------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `no_capacity`   | Refused before doing any work. The expected case under load.   | More workers, or more instances.                                                                         |
| `queue_full`    | Same, reached through a race — the capacity check is advisory. | As above.                                                                                                |
| `queue_wait`    | A job waited longer than it was worth starting.                | Jobs are SLOW, not numerous. Look at file sizes first.                                                   |
| `memory_budget` | The parse budget was committed to other files in flight.       | Arrivals are BIG, not numerous. Raise the task memory and the budget together, or lower the queue limit. |

Counted apart from `GeoPackageValidationFailed`, because the file was never
looked at — a busy spike is a capacity story, not a data-quality one, and mixing
them would hide both.

**Can it be given more workers?** `BackendProcessResidentMb`, sampled after each
validation. This is the telemetry for the rollout's one open question. Worker
threads share this process and their WebAssembly heaps never shrink, so the
figure to compare against the ECS task limit is the whole-process one, not a
per-worker estimate. `ValidationWorkerRestarts` rising alongside it is the OOM
signature; `ValidationWorkerTimeouts` should be flat at zero, and a non-zero rate
means a file is defeating the engine rather than merely being large.

Alongside these, the `geos-worker-validate` evidence line carries the
high-cardinality detail for investigating one upload — GEOS version (which ties a
divergence to a build), pool stats, and the wait and work split again. It rides
on `ENABLE_PERF_EVIDENCE` and will go when that does; the metrics above are the
durable surface and none of them depend on it.

**Not measured, deliberately:** how many times a user polled before getting
through, and how many gave up at the two-minute cap. That is the user-facing
shape of a busy period and it lives in the frontend, which has no metrics
pipeline. `GeoPackageValidationBusy` is a reasonable proxy — one busy response
per poll — but it cannot distinguish ten users retrying once from one user
retrying ten times.

## Habitat sizing comes along for free

`calculateHabitatSizes` used to send the same geometry to PostGIS a second time
to get `ST_Area` / `ST_Length` per feature — a fourth pass over shapes already
parsed, repaired and measured. The worker holds the repaired geometry at the
moment it finishes checking, so the measurements now return with the verdict and
`calculateHabitatSizes` is a pure function.

The sizes are keyed by a feature's position within its layer, because that is all
a worker can know: `featureId` is assigned on the main thread after validation.
`attachGeometrySizes` joins the two, and it must run **before** the
post-intervention Lost filter, which renumbers what is left.

If a feature that should have been measured was not, sizing throws and the upload
fails with `SIZING_FAILED`. That is deliberately fatal rather than partial:
recording some habitats with a size and others without would corrupt the project
document in a way nobody would notice until the units came out wrong.

## Coordinate systems

`SUPPORTED_SRIDS` is `{4326, 27700}`. PostGIS reprojected with `ST_Transform`;
this engine uses proj4js, with the EPSG:27700 definition written out in full in
`geos/reproject.js` and asserted in a unit test.

That assertion matters more than it looks. The accurate WGS84 → British National
Grid transformation uses the **OSTN15 grid shift**; the fallback is a
7-parameter Helmert approximation, and the two differ by up to ~2 m. Several
published EPSG:27700 definitions omit the `+towgs84` parameters altogether, and
one of those is wrong by hundreds of metres.

Measured against PostGIS across eight sites spanning England, the worst-case
disagreement was **0.00075 m** — about 130× inside the tightest tolerance in the
validator (0.1 m) and irrelevant against the 0.5 m² area tolerances. That
agreement held because neither side had the OSTN15 grid: the tested PostGIS image
has no `.tif` files in `/usr/share/proj` and `NETWORK_ENABLED=OFF`, so PROJ fell
back to the same Helmert transform proj4js uses.

> **Open question.** If production PostGIS has the OSTN15 grid installed, it was
> more accurate than this path and EPSG:4326 verdicts may shift by up to ~2 m.
> The fix would be to supply proj4js with the same grid. This is worth settling,
> though it no longer blocks anything: there is no second engine to disagree with.

The England reference polygon is pre-projected once into
`geos/england-27700.json` rather than reprojected per request, and that committed
file is PostGIS's own `ST_Transform` output — so the containment check compares
against exactly the shape the old engine used. `npm run england-27700:check`
re-derives it with proj4 and fails CI if it has drifted from
`reference/england.geojson`.

Note that none of this touches stored data: `persist-upload.js` still transforms
geometry with PostGIS when writing rows. The database remains the system of
record — it just no longer does the checking.
