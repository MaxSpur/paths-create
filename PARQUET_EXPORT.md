# GeoParquet export experiment

The prototype exports batches of paths as GeoParquet 1.1 with Zstandard compression. It is available through a developer harness and benchmark CLI; the main app still exports GPX. No sampling, rounding, noise or changes to saved user data are introduced.

## Run

After `npm ci`:

```sh
npm run benchmark:parquet
# Optional: comma-separated trip counts, then repetitions
npm run benchmark:parquet -- 1000,10000 3
```

The command builds its TypeScript harness, launches a fresh Node process per format/repetition, and writes files and `results.json` under ignored `.benchmark-output/parquet/`. No ORS server or public-service requests are needed. Exported fixtures include licensed bundled IDFM/OSM geometry; preserve the embedded attribution when sharing.

For the browser experiment, run `npm run dev` and open [the harness](http://127.0.0.1:5198/scripts/benchmarks/parquet.html). Choose 100, 1,000 or 10,000 trips, run, and download the verified `.parquet` file. `?count=10000&run=1` starts that fixture automatically. Encoding and independent readback run in a disposable worker. Terminating it after completion releases its WASM memory; only the downloadable bytes return to the main thread. This is a development-only page, excluded from the normal production build.

## Prototype schema

One row represents one leg. Sort by `batch_id`, `trip_id`, then **zero-based** `leg_index` to reconstruct an ordered trip. Batch IDs must be unique per export and trip IDs unique within a batch.

- `geometry`: WKB `LineString` / `LineString Z`, preserving original float64 longitude/latitude and optional elevation values. A single-point leg uses `Point` / `Point Z`. Mixed dimensions within a leg and invalid/nonfinite coordinates are rejected, not silently changed.
- `batch_id`, `trip_id`, `leg_index`, `role`, `mode`, `point_count`, `distance_m` support analysis without decoding geometry. Distance is the original haversine path length in metres.
- Nullable `line_id`, `line_name`, `geometry_source` preserve available provenance; missing provenance remains null.
- `from_json`, `to_json`, `trip_json`, `leg_json` preserve endpoint/collection/address details, transit identity, transfer count, original segment metadata and cycling/parking assumptions. Geometry is excluded from JSON. Trip metadata repeats across its legs for a self-contained first schema; separate trip tables can be evaluated later.
- Parquet footer `geo` metadata declares GeoParquet 1.1, WKB and the geometry types. Omitted CRS defaults to longitude-first OGC:CRS84. Elevation values retain the source values; no vertical datum conversion is asserted.
- Footer `odc` metadata declares prototype schema version 1, index base, synthetic-path status and IDFM/OSM attribution/license links.

There are no individual observation timestamps or GNSS errors. The GPX file creation timestamp is not a movement timestamp and is not synthesized into Parquet observations. Consumers must explicitly support this schema; this is not an importer or complete editable project backup.

## Measurements — 2026-09-10

Apple M2 Max, macOS arm64; Node version is recorded with each run. Deterministic seed 90310 selects diverse subpaths from the bundled bus, metro, RER, train and tram patterns, with synthetic straight access/exit legs and cycling access on one fifth of trips. These are export fixtures, not validated door-to-door journeys. Direct driving/cycling, transfers, 3D and singleton geometry are covered by unit tests, not represented in the bulk timing fixture.

Both formats start from identical structured inputs and preserve their trip/leg metadata. GPX follows its existing seven-decimal formatting; Parquet retains full float64 coordinates. Timings include serialization plus archive/file encoding, exclude initial dependency/WASM loading, fixture construction, disk writes and verification, and follow a ten-trip warmup. Each format/repetition runs in a fresh process. Values below are medians of three runs; MB is decimal.

| Trips / points | Format | File size | Export time | Peak process RSS |
| --- | --- | ---: | ---: | ---: |
| 1,000 / 55,672 | GPX ZIP STORE (current) | 6.59 MB | 0.139 s | 427 MiB |
| 1,000 / 55,672 | GPX ZIP DEFLATE level 6 | 1.69 MB | 0.330 s | 498 MiB |
| 1,000 / 55,672 | GeoParquet ZSTD | 1.00 MB | 0.062 s | 460 MiB |
| 10,000 / 546,082 | GPX ZIP STORE (current) | 65.60 MB | 1.431 s | 658 MiB |
| 10,000 / 546,082 | GPX ZIP DEFLATE level 6 | 16.81 MB | 3.420 s | 767 MiB |
| 10,000 / 546,082 | GeoParquet ZSTD | 9.47 MB | 0.564 s | 693 MiB |

At 10,000 trips, Parquet was 44% smaller than compressed GPX and about six times faster to encode on this fixture. This is not a universal ratio: route length, metadata, repetition, codec and row-group choices matter. Row groups are capped at 4,096 legs; that does not bound total writer memory.

RSS is the process high-water mark measured before readback, including startup, the full parsed transit network, fixtures, warmup, JS/Arrow/WASM allocations and output. Baseline RSS before the 10,000-trip encode was about 449–464 MiB. High-water marks are not isolated allocation deltas, browser memory estimates or proof of streaming. The current writer materializes rows, Arrow IPC, WASM data and the complete output. Larger datasets still need bounded export partitions and integration with incremental generation/storage.

Independent `hyparquet` readback verified every coordinate, trip/leg ordering, modes and origin-point metadata across every Parquet benchmark run. At 10,000 trips, full readback took 300 ms median; reading only trip ID, mode and distance took 12.5 ms (in-memory buffers, excluding validation comparisons). Unit tests also validate GeoParquet metadata discovery, 3D, transfers, source labels and parking assumptions.

The in-app browser worker separately exported 10,000 trips / 30,000 legs / 546,082 points to 9.47 MB in 737 ms, then passed independent exact-geometry verification. This is one warm browser encode, not an end-to-end generation benchmark. The development harness bundles about 387 kB of worker JS and 6.49 MB of WASM (1.92 MB gzip); these dependencies are absent from the current app's startup bundle. Browser-wide peak memory was not measured.

## Next integration

Preserve structured trip inputs as canonical data, generate GPX on demand, and export explicit bounded batches to Parquet. Introduce batch records before redesigning the browser: collapsed batch rows with counts/status, compact child trip rows, mode/line colors and icons with accessible text, and full details for the selected trip. Virtualize long child lists and bound map previews; selection should stay synchronized between map and hierarchy. This UI work remains a separate next step.

Sources: [GeoParquet 1.1](https://geoparquet.org/releases/v1.1.0/), [Parquet WASM](https://github.com/kylebarron/parquet-wasm), [Apache Arrow JS](https://arrow.apache.org/js/current/), [independent reader](https://github.com/hyparam/hyparquet).
