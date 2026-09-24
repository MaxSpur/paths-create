# Local NetMob runs

The browser is the exploration and supervision interface. `npm run netmob:run` is a separate local Node runner writing to one explicit output folder. It reuses browser import, endpoint sampling, ordered-mode routing, movement fitting and Parquet code, with only the existing local ORS service. No hosted routing, geocoding, tiles or new downloads are used.

The EMG has **80,694 rows**, of which **75,784** are geographically eligible. A full run accounts for every row, including exclusions, failures, poor fits and unassessed durations; it cannot promise 80,694 paths or acceptable fits. Survey weights remain metadata. This runner is a bounded pilot, not a completed full-dataset validation.

## Browser supervision

Run `npm run dev` and, in a second terminal, `npm run netmob:serve`. The companion binds **127.0.0.1:5199**; the existing app remains on **127.0.0.1:5198** (preview 4198 also works). In **NetMob → Local runs**, import EMG, apply the Explore filters and Prepare fitting settings, then expand **New job from applied filters**. Select the matching file already in `local/`, choose a simple output folder name, part size, disk cap, free-space reserve and compact variation bound. Creation hashes/reimports the source and checks its filtered count against the browser before pinning a job; it performs no routing. Browser file selection does not grant filesystem paths, so the local input must already exist in `local/`. No upload or source copy is made.

Choose **10**, **100**, **1,000**, **10,000** or **all remaining** rows and **Start / resume stage**. Each stage advances through the pinned selection, not the Explore page or prepared browser pairs. **Pause & checkpoint** aborts the active record and commits finished records. Progress distinguishes processed in memory from durably saved rows; fit counts describe saved rows. Worker RAM and routing requests describe the current invocation, excluding ORS and browser memory. **Start local ORS** invokes only the existing project service script; it neither downloads data nor installs ORS. The controller does not stop the shared ORS service when it exits.

The local controller owns one worker at a time. The browser may close, reload or switch to Manual while that worker continues. On reconnect it selects the active or latest saved job; no EMG reimport is needed for supervision. Stop the controller with Ctrl-C to checkpoint the child first. If the controller is killed, IPC disconnect asks the worker to checkpoint; a subsequent start still respects its process lock. Source or implementation changes require a controller restart; resume also rejects a different pinned implementation. There is no automatic startup, background login item, job scheduling, or automatic full run.

**Review saved rows** pages 25 outcome summaries at a time. **View route** reads one committed part and sends one trajectory plus its original row/fit/ordered legs to the map. Its coordinates are the actual exported variant; timings describe the clean fit. This preview does not load a job into session batches or feed noisy coordinates back into fitting. Each preview has a 32 MiB compressed-part / 100,000-trip-vertex cap. Very large trips remain available in the Parquet files. Files are already saved in the displayed folder; there is no browser download or ZIP.

The controller accepts only the two local app origins (127.0.0.1/localhost), checks Host and a per-launch session token, and validates requests. It confines source files to `local/` and jobs to **`local/netmob-runs/<name>/`**, rejects symlinks and path traversal, and exposes no arbitrary shell, upload, deletion, or external-source API. The published static app has no companion dependency and does not contact it. The HTTP supervisor keeps small status objects; import, route fitting, noise and Parquet writing run in a separate Node process. Preview decoding reads at most one part and retains no geometry cache. Requests/progress are polled at most once per second while active, with trial events throttled to four per second; no trial geometry is streamed.

The companion creates one visible, code-only `local/netmob-controller-*` runtime directory (removed on normal shutdown). A forced wrapper kill may leave that small folder; all durable job data stays in the named output folder. No Python/Gradio stack, hidden database, dense observation files or duplicate final export is needed. Existing CLI jobs outside `local/netmob-runs/` stay accessible with the CLI. Operational cap increases are currently CLI options; the browser creates jobs with fixed limits. Targeted retry of terminal failures remains future work.

## CLI workflow

Start the existing ORS server using [OFFLINE_ROUTING.md](OFFLINE_ROUTING.md). From the project root:

```sh
# Initialize a NEW visible folder; no route generation.
npm run netmob:run -- init --output local/netmob-full
# Process the next 100 source rows, then exit; repeating resumes.
npm run netmob:run -- run --output local/netmob-full
# Check checksums/outcomes; verify also decodes the Parquet files.
npm run netmob:run -- status --output local/netmob-full
npm run netmob:run -- verify --output local/netmob-full
# Larger stage after reviewing the pilot.
npm run netmob:run -- run --output local/netmob-full --max-rows 1000
# Eventual full remainder, only when ready.
npm run netmob:run -- run --output local/netmob-full --max-rows all
```

Initialization defaults: `local/emg-base-des-deplacements.parquet`, 100 source rows per part, 12 trials, calibrated movement, one realization, compact geometric variation, **512 MiB output payload cap**, **1 GiB free-space reserve**. Options: `--source`, `--part-rows`, `--max-output-mb`, `--min-free-mb`, `--clean`. Existing output folders are never replaced. Run-time `--max-output-mb` / `--min-free-mb` overrides apply to that invocation; initialized limits apply next time. No space is preallocated.

`run.json` pins source SHA-256, row count, seeds/settings, implementation/dependency fingerprint, boundary/transit/timing hashes and all three local ORS graph-build metadata hashes. Resume rejects changed inputs or versions. ORS metadata identifies the installed build, not every graph byte. Keep the pinned installation during a job. New matching parameters require a new job; row seeds do not depend on part boundaries.

## Output, bounds and recovery

```text
netmob-full/
  run.json
  part-000000/
    routes.parquet
    outcomes.json.gz
    receipt.json
    owner.json
  part-000100/
    ...
```

Part names use zero-based positions within the pinned selection (physical source rows for unfiltered CLI jobs). Version 2 manifests store original row indices for filtered jobs; legacy version 1 jobs remain readable. Outcomes and Parquet metadata always retain the original physical row identity. Dense selections spanning the whole source omit the redundant index list. Read geometry with `part-*/routes.parquet`; no ZIP or merge is required. Parts without successful routes contain outcomes/receipt/owner only. Parquet retains ordered legs, complete original non-geometric fields, fit results and approximations. The gzip-compressed JSON ledger retains original scalar fields for **every** row, including those without a path.

Only one part's routes remain resident. Parts close at the configured row count or after accumulating 100,000 vertices (checked after each trip; not an individual-route limit). Parquet is independently read back before commit. Geometry, outcomes and checksums are written/fsynced in visible `pending/`, then committed with one directory rename. Resume verifies hashes and contiguous row ranges; no cursor can advance ahead of the committed data. Recognized incomplete staging is discarded, unrelated files stop recovery. A process lock prevents concurrent writers; dead same-host locks can be recovered.

Ctrl-C/termination checkpoints completed rows. The interrupted row is retried on resume. Forced termination can lose work since the last part, but committed parts are reused. Service-wide errors and a 60-second row timeout pause before consuming the affected row. Ordinary no-route outcomes are terminal ledger entries; targeted retry with different settings remains subsequent work.

Before writing, the runner checks job payload bytes plus the next part against the cap, and available disk against the free-space reserve plus an allocation allowance. Filesystem allocation, unrelated writes and ORS logs are outside the payload cap. Small build bundles copy no public assets and are removed normally; killing the wrapper abruptly may leave a small code-only `.benchmark-output/netmob-run-*` directory. No source copies, persistent geometry cache, browser database or observation files are created.

The full scalar EMG table, deduplicated polygons, transit assets and a 512-entry street cache stay in memory. Node's 2 GiB old-space limit is **not** a total-memory limit. A separate 4 GiB RSS guard pauses between records; one search/codec allocation may exceed it. Long-run memory validation remains necessary.

## Compact variation

The runner opts into Parquet variation; ordinary browser exports stay clean. Seeded horizontal offsets interpolate between 100 m distance knots, with default maximum displacement 3 m. Existing vertices only; no added points, timestamps, dense observations or second geometry. Shared leg endpoints receive equal offsets; elevations and canonical routes remain unchanged. This is visual variation, not a validated GNSS receiver model.

`trip_json.geometryVariation` records version, method, identity, seed and settings. `geometry` and `distance_m` describe perturbed coordinates; fitted/recorded times, sampled endpoints and modeled-leg distances still describe the clean route. Clean snapped endpoints passed containment; perturbed geometry may cross boundaries slightly. Metadata exposes this distinction. Noise parameters alone do not reconstruct exact clean geometry; use `--clean` when clean coordinates are needed.

## Browser integration verification

The final browser-controlled job `local/netmob-runs/metro-10-20-current` pins METRO, 10–20 minutes (1,459 matching source rows), 12 trials, movement fitting, 3 m variation, five-row parts and an 8 MiB cap. A browser pause saved 41 rows; a ten-row resume ended at **51 unique source rows**, with **36 acceptable and 15 poor fits**, 263,716 payload bytes in 11 parts. All 36 pre-resume part files stayed byte-identical. Independent CLI verification decoded all saved trips and checked source metadata, original row identity and ordered legs.

A preceding integration job `metro-10-20-pilot` remains readable with 110 saved rows (74 acceptable, 29 poor, one excluded, six failed); it demonstrated browser reload during generation and pause. It pins an earlier implementation, so resume is intentionally rejected by the version guard. Its 388,869 bytes are retained as a readback fixture, not migrated silently. Both visible job folders together occupy about **916 KiB** on disk; the active controller code bundle occupies about **132 KiB**. No full run is active. The final job is paused and can resume with the unchanged implementation.

In-app browser checks covered filtered creation, stage start, pause/resume, reload/reconnect, controller restart, keyboard saved-row pagination, actual exported geometry/endpoint previews, metadata, and Manual's nine saved places and From/To selection. The full gate was run once: 215 tests passed and one old generic progress selector failed after the second progress bar was added. Scoping it to the browser-pilot bar made the affected 19-test regression set pass. All 216 tests are covered by those passing runs. Browser and runner TypeScript, production build and the unchanged 82.0 KiB initial bundle budget passed; local-panel CSS is lazy-loaded. Synthetic controller tests mock ORS and exercise loopback HTTP, request validation, source-path confinement, single-worker control, pause/reconnect, filtered checkpoints and exact varied-Parquet preview readback. Real ORS startup from stopped state, forced process/power loss, and 1,000/10,000-row endurance remain unverified.

## Measurements and next gates

Durable pilot verification on 2026-09-22: `local/netmob-run-pilot` contains 300 sequential source rows in 15 parts (20-row windows), 279 routes: 227 acceptable, 52 poor, 14 exclusions and 7 failures. It uses 0.850 MB payload / about 0.97 MiB filesystem allocation. A real SIGINT after row 220 left row 221 pending; resume continued through row 300. The first ten Parquet files stayed byte-identical. Independent `verify` checked all checksums, source fields, links and leg ordering. This job has an 8 MiB test cap. It is intentionally incomplete; no full run was launched.

The full test run passed 209 tests. Its build initially found a Node-only test outside the browser TypeScript project; after moving that test beside the runner, its five tests, the build, bundle check and separate strict runner/harness typecheck passed. Browser verification restored the EMG import after development reload and confirmed the nine Manual places/settings remained available. Budget rejection, corrupt parts, incompatible settings, duplicate rows, concurrent lock refusal and unrecognized staging are covered by synthetic tests. Hard-kill/power-loss and long-duration endurance remain unverified.

`npm run benchmark:netmob-scale -- 1000` hash-samples **all** EMG rows, including exclusions. It holds one 100-source-row window, alternates clean/noisy codec ordering on identical winning routes, and independently verifies all coordinates, ordered legs and source metadata. It writes no path files, only `local/netmob-scale-results.json` (5 MiB cap). Count `0` measures import/preflight only. No public services are queried.

Measured 2026-09-22, Node 26.3.0, existing warm ORS, 12 trials:

| Metric | Result |
| --- | ---: |
| Source rows | 1,000 |
| Generated / acceptable / poor | 933 / 721 / 212 |
| Excluded / failed | 49 / 18 |
| Vertices | 126,309 |
| Clean Parquet, ten parts | 2.426 MB |
| Varied Parquet, same vertices | 2.516 MB (+3.71%) |
| Clean / varied encoding, summed | 153 / 190 ms |
| Separate variation computation | 68 ms |
| Experiment, excluding initial import | 151 s |
| Local ORS requests / cache hits | 18,481 / 100 |
| Peak Node RSS | 2,038 MiB |

Varied encoding already includes noise; the separate 68 ms repeats it for verification. All 933 routes passed exact readback in both variants. Codec totals are single-run small-part measurements, not a robust speed comparison. Post-part RSS ranged 1,466–1,976 MiB without monotonic growth over ten checkpoints; Java ORS memory is additional. Both benchmark and runner collect garbage between parts.

Simple scaling gives **about 203 MB of path Parquet, 3.4 hours and 1.49 million local requests** for 80,694 rows. It excludes outcome ledgers, filesystem overhead, durable commit/readback costs and interruptions. This is a planning estimate, not a forecast. Rare modes, participant dependence, route-length tails, sequential production order, warm caches and machine load limit extrapolation. Sampling is unweighted with no mode balancing. Full per-row costs, mode mix and checkpoints are in the 215 KB report.

Before full execution: verify a small durable window, cancellation/resume without duplicates, and independent file readback; then stage 1,000 and 10,000 sequential rows and confirm stable memory/disk projections. The browser now launches and monitors this runner. Targeted retry jobs, consolidated analysis tables and bulk timed observations remain subsequent work.
