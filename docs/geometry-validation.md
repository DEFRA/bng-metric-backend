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
| `VALIDATION_BUSY_RETRY_AFTER_SECONDS` |       5 | `Retry-After` on the 503. The frontend honours this.                 |

The pool cap **is** the admission control. It is the same protective bounding the
connection pool used to provide, except the rationed resource is CPU on an
instance CDP can add more of.

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

A queued validation belongs to a request sitting inside
`validateGeoPackageLayers`, and that request still has the parsed GeoPackage the
format gate produced: measured at **~29 MB of heap per in-flight upload** on the
5,000-parcel fixture. Eight queued plus two in flight is therefore up to ~290 MB
on top of the workers' own ~500 MB.

Unlike the workers' WebAssembly heap this memory is **transient** — garbage once
the request ends, not a high-water mark. But **raising
`VALIDATION_WORKER_QUEUE_LIMIT` raises that ceiling directly**, and it is worth
being clear that the limit rations CPU rather than memory. If a task is tight on
memory, lowering the queue limit is a better lever than lowering the worker
count: the workers are what earn the throughput, and the queue is what quietly
eats the headroom.

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

| `reason`      | Means                                                          | Remedy                                                 |
| ------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| `no_capacity` | Refused before doing any work. The expected case under load.   | More workers, or more instances.                       |
| `queue_full`  | Same, reached through a race — the capacity check is advisory. | As above.                                              |
| `queue_wait`  | A job waited longer than it was worth starting.                | Jobs are SLOW, not numerous. Look at file sizes first. |

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
