# GeoParquet export

The main app exports batches as GeoParquet 1.1 with Zstandard compression, or compressed GPX. Browser batch exports introduce no sampling, rounding or noise. Choose the open batch or all batches; export scope is independent of visible trip pages. The optional [local NetMob runner](NETMOB_RUNS.md) writes independent durable parts and can request compact geometry variation.

App exports split each batch into parts of at most 1,000 trips. Each part is serialized in a disposable worker. A single Parquet part downloads directly; multiple parts are wrapped in a ZIP with a batch/file manifest. GPX parts are individual DEFLATE ZIPs, likewise wrapped for multiple parts. Footer `odc.batches` retains batch name, creation time and original generation report even for standalone Parquet files. Cancellation stops workers and prevents the final download. Existing GPX names are retained inside each part.

Generation retains structured inputs with shared geometry rather than prebuilt GPX strings. Metadata is snapshotted, so editing a place later does not rewrite earlier exports. The final multi-part download still accumulates in memory; this is not streaming to disk or a persistent batch store. Reload clears generated batches.

## Run

After `npm ci`:

```sh
npm run benchmark:parquet
# Optional: comma-separated trip counts, then repetitions
npm run benchmark:parquet -- 1000,10000 3
```

The command builds its TypeScript harness, launches a fresh Node process per format/repetition, and writes files and `results.json` under ignored `.benchmark-output/parquet/`. No ORS server or public-service requests are needed. Exported fixtures include licensed bundled IDFM/OSM geometry; preserve the embedded attribution when sharing.

For the browser experiment, run `npm run dev` and open [the harness](http://127.0.0.1:5198/scripts/benchmarks/parquet.html). Choose 100, 1,000 or 10,000 trips, run, and download the verified `.parquet` file. `?count=10000&run=1` starts that fixture automatically. Encoding and independent readback run in a disposable worker. Terminating it after completion releases its WASM memory; only the downloadable bytes return to the main thread. This is a development-only page, excluded from the normal production build.

## Schema

One row represents one leg. Sort by `batch_id`, `trip_id`, then **zero-based** `leg_index` to reconstruct an ordered trip. Batch IDs must be unique per export and trip IDs unique within a batch.

- `geometry`: WKB `LineString` / `LineString Z`, preserving original float64 longitude/latitude and optional elevation values. A single-point leg uses `Point` / `Point Z`. Mixed dimensions within a leg and invalid/nonfinite coordinates are rejected, not silently changed.
- `batch_id`, `trip_id`, `leg_index`, `role`, `mode`, `point_count`, `distance_m` support analysis without decoding geometry. Distance is the original haversine path length in metres.
- Nullable `line_id`, `line_name`, `geometry_source` preserve available provenance; missing provenance remains null.
- `from_json`, `to_json`, `trip_json`, `leg_json` preserve endpoint/collection/address details, transit identity, transfer count, original segment metadata and cycling/parking assumptions. Geometry is excluded from JSON. Trip metadata repeats across its legs for a self-contained first schema; separate trip tables can be evaluated later.
- Parquet footer `geo` metadata declares GeoParquet 1.1, WKB and the geometry types. Omitted CRS defaults to longitude-first OGC:CRS84. Elevation values retain the source values; no vertical datum conversion is asserted.
- Footer `odc` metadata declares schema version 1, index base, synthetic-path status and IDFM/OSM attribution/license links.

There are no individual observation timestamps or GNSS errors. The GPX file creation timestamp is not a movement timestamp and is not synthesized into Parquet observations. Consumers must explicitly support this schema; this is not an importer or complete editable project backup.

## NetMob extension

GeoParquet columns, CRS, exact coordinates and zero-based ordering remain schema 1. NetMob adds `trip_json.netmob.version = 1`: dataset SHA-256, source key/row index, original non-geometric fields, temporal issues, departure wall time, sampled endpoints, boundary provenance, seed/realization/trial settings, fit metrics and network/timing versions. Transit results also retain feed dates/hash/estimation method. `leg_json.modeled` carries recorded and selected mode, proxy assumptions, geometry/timing sources, modeled duration/distance, boarding wait, and elapsed start/end offsets. Duration excludes the separately stored wait; offsets and trip totals include it. Geometry never repeats in this metadata.

One source record remains one trip regardless of survey weight. Inferred modes and poor fits remain explicit. Filtering to acceptable fits changes exported trips but retains the original batch report and its failures/exclusions; zero-success reports can be saved separately. GPX uses the same ordered legs and NetMob extension under trip schema 5. No per-point timestamps are synthesized. This extension does not make path exports importable as EMG input or as a saved project.

## Compact local-run variation

`writePathParquet(batches, {variation})` optionally perturbs existing vertices through `compactPathNoise.ts`. It adds no points or columns. `trip_json.geometryVariation` and the file footer disclose method/version, settings, deterministic identity, clean timing basis and boundary policy. `geometry`/`distance_m` describe the varied path; original NetMob metadata and modeled-leg measurements remain clean. Existing callers omit the option and retain exact coordinates. The local runner enables variation by default; `--clean` disables it. See [compact variation and matched measurements](NETMOB_RUNS.md#compact-variation).

## Measurements — 2026-09-10

Apple M2 Max, macOS arm64; Node version is recorded with each run. Deterministic seed 90310 selects diverse subpaths from the bundled bus, metro, RER, train and tram patterns, with synthetic straight access/exit legs and cycling access on one fifth of trips. These are export fixtures, not validated door-to-door journeys. Direct driving/cycling, transfers, 3D and singleton geometry are covered by unit tests, not represented in the bulk timing fixture.

Both formats start from identical structured inputs and preserve their trip/leg metadata. GPX follows its existing seven-decimal formatting; Parquet retains full float64 coordinates. These measurements describe the original monolithic prototype, not the newer 1,000-trip app partitions. Timings include serialization plus archive/file encoding, exclude initial dependency/WASM loading, fixture construction, disk writes and verification, and follow a ten-trip warmup. Each format/repetition runs in a fresh process. Values below are medians of three runs; MB is decimal.

| Trips / points | Format | File size | Export time | Peak process RSS |
| --- | --- | ---: | ---: | ---: |
| 1,000 / 55,672 | GPX ZIP STORE (current) | 6.59 MB | 0.139 s | 427 MiB |
| 1,000 / 55,672 | GPX ZIP DEFLATE level 6 | 1.69 MB | 0.330 s | 498 MiB |
| 1,000 / 55,672 | GeoParquet ZSTD | 1.00 MB | 0.062 s | 460 MiB |
| 10,000 / 546,082 | GPX ZIP STORE (current) | 65.60 MB | 1.431 s | 658 MiB |
| 10,000 / 546,082 | GPX ZIP DEFLATE level 6 | 16.81 MB | 3.420 s | 767 MiB |
| 10,000 / 546,082 | GeoParquet ZSTD | 9.47 MB | 0.564 s | 693 MiB |

At 10,000 trips, Parquet was 44% smaller than compressed GPX and about six times faster to encode on this fixture. This is not a universal ratio: route length, metadata, repetition, codec and row-group choices matter. Row groups are capped at 4,096 legs; that does not bound total writer memory.

RSS is the process high-water mark measured before readback, including startup, the full parsed transit network, fixtures, warmup, JS/Arrow/WASM allocations and output. Baseline RSS before the 10,000-trip encode was about 449–464 MiB. High-water marks are not isolated allocation deltas, browser memory estimates or proof of streaming. The current writer materializes rows, Arrow IPC, WASM data and the complete output. The app now uses bounded export partitions; larger datasets still need incremental generation/storage and a way to avoid accumulating the final download archive.

Independent `hyparquet` readback verified every coordinate, trip/leg ordering, modes and origin-point metadata across every Parquet benchmark run. At 10,000 trips, full readback took 300 ms median; reading only trip ID, mode and distance took 12.5 ms (in-memory buffers, excluding validation comparisons). Unit tests also validate GeoParquet metadata discovery, 3D, transfers, source labels and parking assumptions.

The in-app browser worker separately exported 10,000 trips / 30,000 legs / 546,082 points to 9.47 MB in 737 ms, then passed independent exact-geometry verification. This is one warm browser encode, not an end-to-end generation benchmark. The development harness bundles about 387 kB of worker JS and 6.49 MB of WASM (1.92 MB gzip); these dependencies are absent from the current app's startup bundle. Browser-wide peak memory was not measured.

## Integration verification

The isolated browser app fixture generates direct driving/cycling batches using mocked street services, checks paged navigation, keyboard focus, map-to-list selection, mobile width, real worker cancellation/retry, standalone Parquet and multi-part GPX/Parquet downloads. Independent Parquet reading and ZIP inspection verify exported counts and batch metadata. No saved user data or hosted credentials are used. Unit coverage also exercises cross-batch reveal, bounded rows/previews, deletion/reuse, scope and cancellation, and avoids evaluating lazy GPX during Parquet partitioning.

Generation and its canonical inputs still live in page memory. Future scaling work includes persisted/resumable batches and incremental storage; the hierarchy and bounded previews are now implemented.

Sources: [GeoParquet 1.1](https://geoparquet.org/releases/v1.1.0/), [Parquet WASM](https://github.com/kylebarron/parquet-wasm), [Apache Arrow JS](https://arrow.apache.org/js/current/), [independent reader](https://github.com/hyparam/hyparquet).

NetMob source fields are retained in each trip's `trip_json.netmob.raw`, including nulls, original mode spelling and survey weights. Tests compare the complete raw record after Parquet readback. Source polygon/centroid payloads are not embedded; exported geometry is the generated ordered route, with sampled endpoints and boundary provenance in metadata. Map visibility does not change export scope.

Optional movement observations use a separate Point GeoParquet schema with clean/noisy coordinates and synthetic elapsed seconds; the leg-based path export above remains unchanged. See [MOVEMENT_SIMULATION.md](MOVEMENT_SIMULATION.md#noise-and-storage).
