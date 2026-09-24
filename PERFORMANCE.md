# Performance

## Measurement contract

Run `npm run benchmark` for offline rail-graph and panel-DOM fixtures. Establish a baseline before editing; use the same workload/environment, warmup and repeated measurements, reporting median/p95 where practical. Keep correctness checks alongside timing and separate live-service latency from app CPU/DOM work.

- `scripts/benchmarks/railGraph.bench.ts`: station snapping and shortest paths on 40k nodes.
- `scripts/benchmarks/panel.bench.ts`: full render versus progress patch.
- `npm run check`: tests, build and bundle budget.
- `scripts/check-bundle-size.mjs`: sums gzip bytes of JS/CSS directly referenced by `dist/index.html`, capped at 84,000 bytes. It does not recursively traverse imports; revisit coverage if chunk loading changes.

## Batch export measurements

The [local NetMob scale experiment](NETMOB_RUNS.md#measurements-and-next-gates) compares clean/varied Parquet on 1,000 hash-random source rows using bounded 100-row windows. It includes real fitting costs, exclusions, exact readback and part-level memory checkpoints; this is distinct from the synthetic format benchmark below.

`npm run benchmark:parquet` compares current ZIP, DEFLATE ZIP and GeoParquet on identical structured fixtures, with independent exact geometry readback. See [PARQUET_EXPORT.md](PARQUET_EXPORT.md) for the method, schema, memory limits and 1,000/10,000-trip measurements.

## Runtime constraints

- Coalesce synchronous UI invalidations into a microtask; patch progress and clock DOM.
- Invalidate station, active-point and preview layers independently. Map-view persistence alone must not rebuild them.
- Metro trips share coordinate arrays: deduplicate base preview segments by identity, then add one selected-trip overlay.
- Rail graphs use spatial lookup for snapping, lazy shortest-path state and linear path reconstruction.
- Load export orchestration on download; Parquet/Arrow/WASM and GPX encoding run in disposable workers. Keep structured inputs with shared geometry instead of eager GPX strings. The batch-browser integration raises the initial budget from 80,000 to 84,000 bytes for its controls, paging and focus handling; the multi-megabyte WASM binary remains deferred.
- Lazy-load the transit router and 36.07 MB regional JSON (5.76 MB gzip when hosting compresses it) on first transit generation. The startup gate excludes this deferred dataset; `idfmTransit.test.ts` checks its structure and reference journeys. Rebuild statistics and source hash live in its manifest.
- `generationRouteCache.ts` bounds page-session reuse to 16 metro setups and 512 street access legs. Keys include exact ordered coordinates and applicable endpoint/profile/query parameters. Reset/reload clears it. Cache valid geometry only; successful rail geometry survives an elevation failure so elevation can be retried later.
- Legacy station-routing calls also retain 16 resolved transit itineraries keyed by snapshot version/station coordinates. Automatic place routing reuses graph preprocessing and the 512 street-access cache with distinct walking/cycling profile keys, memoizes successful/failed requests within each batch, and bounds station refinement to 12 searches per pair. It does not query a Cartesian station-pair matrix. Exact rail geometry is interned per immutable network by line and coordinates (128 arrays / 50,000 points) to retain shared preview layers. The immutable network's routing graph is reused; per-trip access connectors retain shared rail arrays.
- Search shares the Nominatim limiter; priority/cache improvements cannot guarantee live response time.

## Browser acceptance fixture

Reuse a small state around Vincennes (`48.847, 2.439`) and Géodata Paris in Champs-sur-Marne (`48.8411, 2.5874`). Check only flows affected by the change:

- Search both names, select the intended French result, verify map focus and result dismissal; check narrow-screen search/zoom controls.
- For generation, compare cold and warm append batches with a fixed seed and unchanged point pools. Record trip counts, visible progress/report, route reuse and failures.
- For previews, compare base Leaflet layer counts and selection overlays as trip count grows. Pure segment counts do not establish rendered layer counts.

Automated fixtures mock services. Live checks preserve curated user data and distinguish measured elapsed time from polling bounds. Lifecycle/layer-count coverage remains in [TODO.md](TODO.md); structural sidebar changes still rebuild the panel.

## Historical reference — 2026-08-08

macOS arm64, Node 26.3.0, npm 11.16.0. Baseline used Vitest 2.1.9/Vite 5.4.21; optimized work used Vitest 4.1.10/Vite 8.2.1. These are recorded observations, not current measurements or isolated dependency comparisons.

| Scenario | Before | After |
| --- | ---: | ---: |
| 40k-node graph, snap two stations | 4.652 ms mean | 0.0446 ms mean |
| 40k-node graph, connected-row path | 3.094 ms mean | 0.0250 ms mean |
| 90k-node line, worst-case path | 659 ms median | 24.86 ms median |
| 250-point/250-trip progress | 86.67 ms full render | 1.72 ms patch |
| 20×20 metro preview, unselected | 1,200 polylines | 41 unique polylines |
| Walking / driving-alternatives ORS 401 | 4 / 8 requests | 1 / 1 request |

The recorded initial JS+CSS payload after the route-cache follow-up was 71.8 KiB gzip. Read current size from the gate.

A live 20-point-per-station fixture first exposed a primary Overpass 504, raw HTML error text and a stale report. After bounded fallback/error/report fixes, a cold 20-trip run completed within the first five-second observation; the next batch took about 325 ms with metro path and 40/40 walking legs reused. Forty trips produced 65 base SVG paths (including station/point layers); selection added three paths. These service/UI observations are not CPU benchmark guarantees.

## Bus snapshot reference — 2026-09-07

Offline Node sample on the bus-inclusive snapshot: 20 distinct regional bus-stop pairs, max three changes, 20 connected; 2.594 s total, 113 ms median / 300 ms p95, including first graph preparation. Sampled end heap was about 290 MiB, not peak memory. Twenty shorter same-line pairs took 0.244 s total (1.09 ms median). These measure graph search only: no actual street routes, automatic access refinement, browser layers or network latency. They are not end-to-end throughput predictions. Local ORS installation and measured independent-pair benchmark results are in [OFFLINE_ROUTING.md](OFFLINE_ROUTING.md).

The production browser displays at most 10 batch headings and 50 trip rows, plus one detail inspector. Map previews show the open page and selected trip; this trades an all-routes overview for bounded Leaflet work. Export part limits are in PARQUET_EXPORT.md; they do not bound final archive memory.

## Snapshot integrity test — 2026-09-10

The full bus-inclusive snapshot check approached Vitest's 5 s default timeout on CI. On the same local fixture, replacing repeated Vitest matchers inside the dataset loops with Node strict assertions preserves exhaustive validation and indexed failure messages while avoiding matcher-allocation overhead. A single matched local before/after run measured 4.383 s versus 104 ms for that test (not a repeated statistical benchmark). The dataset-wide test alone has a 15 s timeout; normal tests retain their default. This is a correctness gate, not an application-speed benchmark.

## NetMob pilot

Full-file imports, paged queries and matched local-routing samples of 1/10/100 records are documented with scope and memory limits in [NETMOB.md](NETMOB.md#bounds-measurements-and-reproduction). Run `npm run benchmark:netmob` for import-only work; positive counts explicitly use local ORS. This is separate from the manual route-cache and export benchmarks.

## NetMob trial visualization

Measured in the in-app browser on 2026-09-14 using local ORS: first 20 geographically eligible EMG rows matching METRO, duration 10–20 minutes; seed 90314, realization 0, 12 trials. Fresh page/import for each run, identical settings, same local routing process. Generation worker timing excludes import/asset loading and the final review render.

| Live trial drawing | Generation time | ORS requests | Completed / acceptable / poor |
| --- | ---: | ---: | --- |
| On (maximum 4 updates/s) | 8.580 s | 1,010 | 20 / 13 / 7 |
| Off | 8.647 s | 1,010 | 20 / 13 / 7 |

This single matched pair showed no detectable slowdown from live previews (difference below 1%); it is not a statistically robust speedup or proof for every workload. Earlier previews rebuilt polygon layers on every trial and had not been benchmarked. The current lazy canvas overlay reuses areas/routes, throttles trial redraws, and lets users disable drawing without changing candidate order or progress reporting. Multi-batch rendering has no 100-route cap; vertex count and browser resources determine practical limits.

## Movement fitting and observations

See [MOVEMENT_SIMULATION.md](MOVEMENT_SIMULATION.md#calibration-strategy-and-reproduction) for participant-separated calibration, fresh random-row validation, matched trial-budget comparisons and memory limits. Candidate scoring evaluates phases only; dense motion/noise remains a selected-route operation. Calibration and validation save scalar statistics, not paths.

The NetMob local controller streams small status objects at up to 1 Hz to the browser, with worker trial events throttled to 4 Hz. It sends no live trial geometry. Saved review is bounded to 25 outcome summaries and one trajectory; the companion decodes at most one committed part. Fitting/Parquet encoding remain in a separate bounded Node process. See [controller measurements and remaining gates](NETMOB_RUNS.md#browser-integration-verification); the first 100-row METRO 10–20 minute stage took about 27 seconds and 4,811 local routing requests. This workload is not a whole-file throughput forecast.
