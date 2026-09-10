# Local ORS

Run the same IDF routing setup from a fresh checkout: native ORS 9.10.0, a pinned IDF street extract, and walking, cycling and driving graphs. No Docker or login daemon is required. The transit network, including buses, is already bundled in the repository.

## First installation (macOS / Linux)

1. Install Node.js matching [.node-version](.node-version) and npm matching the requirements in [package.json](package.json).
2. Install **Java 21** if `java -version` does not show a suitable runtime. Use the [official Temurin installation instructions](https://adoptium.net/installation). ORS requires Java 17+; this configuration was verified with Java 21. The launcher honors `JAVA_HOME`, otherwise it uses `java` from `PATH`. Windows process management is not supported by these scripts.
3. Allow about **425 MB of downloads**, plus graph storage. The measured installation occupies 1.18 GiB; reserve 5–10 GB for build/update headroom. The launcher allows an 8 GB heap, so leave room for the OS and browser as well. Peak import memory and lower-memory machines have not been benchmarked.
4. From the cloned project directory, run:

```sh
npm ci
npm run ors:install
npm run ors:start
npm run ors:status
```

The installer downloads only the JAR and PBF pinned in [scripts/ors-inputs.json](scripts/ors-inputs.json), verifies their byte counts and SHA-256 hashes, and stores them in ignored `.local-ors/`. Existing matching files are reused; mismatched files are never overwritten. It does not install Java, start the server or rebuild graphs. Network access is needed for the initial downloads.

Wait until status reports `HTTP 200: {"status":"ready"}`. First startup builds all three graphs and can take several minutes; inspect the log or run `ors:status` again while waiting. Then run:

```sh
npm run dev
```

Open [http://127.0.0.1:5198/](http://127.0.0.1:5198/) and select **Service settings → Routing service → Local ORS**. No ORS API key is required. Create places/areas and points, then use each point's mode button: **T** transit, **D** driving, **C** cycling, **C+T** cycling to transit. Personal places, points, preferences and keys live in browser storage and are not included in a clone. See [README.md](README.md) for trip generation and the cycling/transit limitations.

## Installation recovery and updates

- Failed or interrupted downloads can be retried with `npm run ors:install`; completed verified inputs are reused. Normal failures remove temporary downloads. After a forcibly killed installer, first ensure no installer is running, then remove its `.local-ors/.install-lock` directory and any abandoned `.download-*` folders before retrying.
- If checksums differ, preserve the existing files and investigate the source/version. Do not bypass verification or combine new inputs with old graphs.
- The IDF input is the **2026-09-09 snapshot**, not a moving `latest` URL. Geofabrik may eventually remove dated downloads. If unavailable, copy the exact verified input from an existing installation into `.local-ors/` and rerun the installer. Otherwise a maintainer must deliberately update the URL, size and checksum pins and build new graphs; that changes the routing snapshot.
- To upgrade the engine, source extract or graph-build configuration, stop ORS and wait for its process to exit. Preserve the old `.local-ors/` folder outside that path, update the pins/configuration, then install and start afresh. Allow space for both installations. Reload the app after activating new graphs to clear route caches.

## Start, inspect, stop

Run from the project directory:

```sh
npm run ors:start
npm run ors:status
npm run ors:stop
```

Start launches a background process. Wait for `HTTP 200: {"status":"ready"}` before generating. The first run prepares graphs; later starts reuse them. The stop command verifies the PID belongs to this project's JAR before sending SIGTERM. It does not stop unrelated Java processes. A restart of macOS requires running `ors:start` again.

- Server: `http://127.0.0.1:8082/ors`; loopback only.
- Configuration: [scripts/ors-config.yml](scripts/ors-config.yml), with an 8 GB Java heap ceiling set by the launcher.
- Ignored runtime folder: `.local-ors/` contains `ors.jar`, `ile-de-france.osm.pbf`, `graphs/`, `manifest.json`, `process.json` and `logs/`.
- Logs: `.local-ors/logs/console.log` and `ors.log`. `503/not ready` is normal during initialization. If startup fails, inspect the log and port owner; do not silently switch ports.

## What is local

The companion provides `foot-walking`, `cycling-regular` and `driving-car` directions for each actual endpoint pair. The browser still chooses transit lines/stops and generates GPX. No hosted API key is required or transmitted in local mode; switching back to Hosted ORS preserves the saved key.

The first installation intentionally uses **2D street geometry**. Build elevation and cycling elevation consideration are disabled; there are no automatic elevation or graph downloads. Both graph-build and request settings matter: request `elevation:false` alone does not prevent DEM downloads during import. Basemap tiles, address lookup and location search remain separate online services. Disable address lookup for large point batches.

CORS allows the fixed local dev/preview origins on ports 5198/4198. Use the locally served app; a deployed HTTPS page contacting a loopback HTTP service has not been validated. Regional boundaries can clip routes that leave/re-enter IDF, and disconnected or inaccessible points can legitimately fail.

## Measured installation and routing

Machine: Apple M2 Max, 12 cores, 96 GiB RAM, Java 21.0.2. Downloaded JAR: 86,812,074 bytes; IDF PBF: 337,908,641 bytes (about 425 MB combined). The JAR SHA-256 was checked against GitHub's release digest and the PBF against Geofabrik's MD5; the local manifest records its SHA-256 and download date.

First graph initialization took **179.6 seconds** with two initialization threads. Disk allocation after building all three profiles was approximately **1.18 GiB total**, including software, source data and logs: 296 MiB cycling graphs, 188 MiB driving, 290 MiB walking. This is substantially below the earlier 5–10 GB planning allowance. Keep additional space for replacement graphs and GPX outputs. A verified restart loaded the saved graphs and started in about 2.5 seconds. Idle resident memory sampled after restart was about 1.4 GiB. The configured 8 GB heap is a ceiling, not measured peak usage.

The manual benchmark uses 1,000 pairs formed from 2,000 distinct coordinates in the bundled IDFM stops, shuffled with seed 90310. All profiles use the same pairs, two concurrent requests and full GeoJSON responses. There is no response cache or distance-matrix substitution. A 100-pair smoke run preceded it, so these are warm-server measurements.

| Profile | Successful / attempted | Total time | Median / p95 latency |
| --- | ---: | ---: | ---: |
| Walking | 992 / 1,000 | 21.79 s | 19.69 / 161.41 ms |
| Cycling | 992 / 1,000 | 41.78 s | 33.97 / 326.27 ms |
| Driving | 990 / 1,000 | 0.65 s | 1.27 / 1.79 ms |

Walking/cycling each had eight point-not-found errors; driving had nine point-not-found errors and one disconnected route. Failures remain in the denominator. These [ORS codes](https://giscience.github.io/openrouteservice/api-reference/error-codes) describe unavailable endpoints/routes, not server crashes.

Reproduce with `npm run ors:benchmark -- 1000`; output is `.local-ors/benchmark-1000.json`. This is an explicit local-server operation, excluded from automated checks. It measures street queries and response parsing, not total app throughput, driving alternatives, access-candidate refinement, transit CPU, Leaflet rendering or ZIP export. A real browser transit trip from Saint-Denis to Noisy–Champs also completed successfully through local ORS.

Thousands of independently computed street routes are feasible. Large app batches still need resumable/cancelable processing, background transit search, bounded previews and incremental storage/export. Those remain in [TODO.md](TODO.md); the benchmark does not establish full 10,000-trip app performance.

## Sources

- [Official native JAR instructions](https://giscience.github.io/openrouteservice/run-instance/running-jar): Java 17+; an existing Java 21 runtime was used here.
- [Pinned ORS 9.10.0 release](https://github.com/GIScience/openrouteservice/releases/tag/v9.10.0): the installer pins its JAR and release digest.
- [Geofabrik IDF extract](https://download.geofabrik.de/europe/france/ile-de-france.html): the installer pins the dated extract matching the measured installation.
- [Pinned release defaults](https://github.com/GIScience/openrouteservice/blob/v9.10.0/ors-api/src/main/resources/application.yml): car CH/Core and walking/cycling landmark preparation remain enabled; local config overrides elevation and network binding.
