# Architecture

The UI, transit search and GPX generation run in the browser. An optional local Java ORS companion provides street routes; hosted ORS remains available. `src/main.ts` mounts `createApp`; Leaflet displays arbitrary places, circular point pools and generated GPX trips. Automatic transit uses the Île-de-France GTFS-derived network; other regions report coverage limits while driving/cycling remain available. No schedules are modeled.

## Ownership

| Area | Source |
| --- | --- |
| Orchestration, async workflows, persistence wiring, downloads | `src/ui/app.ts` |
| Leaflet layers, map controls and imperative behavior | `src/ui/map.ts` |
| Sidebar markup/events and HTML escaping | `src/ui/panel.ts`, `src/ui/html.ts` |
| Pure map-click intent and search-result ranking | `src/ui/interaction.ts`, `src/ui/locationSearch.ts` |
| Render coalescing and shared preview geometry | `src/ui/renderScheduler.ts`, `src/ui/previewSegments.ts` |
| State defaults, normalization and localStorage | `src/lib/stateStore.ts` |
| Generation and page-session route reuse | `src/lib/generator.ts`, `src/lib/generationRouteCache.ts` |
| Transit loading, directed service routing, walking connections | `src/lib/transitNetwork.ts`, `src/lib/transitRouter.ts`, `src/lib/transitWalking.ts` |
| Routing/elevation, rail queries, search/address queue | `src/lib/orsClient.ts`, `src/lib/overpassClient.ts`, `src/lib/geocode.ts` |
| Rail graph, station snapping and shortest paths | `src/lib/railGraph.ts` |
| GPX serialization and lazy ZIP export | `src/lib/gpxWriter.ts`, `src/lib/exportZip.ts` |
| Place creation and whole-pool movement | `src/lib/places.ts` |
| Radius, sampling, pairing and coordinate helpers | `src/lib/stationRadius.ts`, `sampling.ts`, `pairing.ts`, `geo.ts` |

## State and generation

`odc.generator.state.v1` now carries schema 3. The key and legacy `stations`/selection field names remain stable for lossless migration; `StationRecord` aliases `PlaceRecord`. Missing `kind` becomes `area`; `point` places own exactly one point and share its coordinates. Malformed point places with multiple saved points become areas rather than discarding data. Existing names, radii, IDs, addresses, point modes and selections survive. Fresh state uses per-point modes. Schema 1/2 global choices, when present, are applied once to all saved points to preserve their effective travel mode; older Mixed/missing choices retain individual modes. Schema 3 never reapplies a global choice.

Points store `metro` (T), `driving` (D), `cycling` (C), or `cycling_transit` (C+T); the UI has no global mode selector. The legacy generation `routingMode` field normalizes to `point_modes`. Generation stores `maxAccessDistanceM` (100–5000, default 1500), `maxCyclingDistanceM` (100–20000, default 5000), and `maxTransfers` (0–3, default 3). Sampling radius is independent. Normalization bounds controls and clears invalid selections. Moving an area translates its entire pool while preserving local offsets; moving a single place keeps its point/center together. Moves invalidate addresses. Shrinking radius retains existing points.

`generateTrips`:

1. Validates the hosted ORS key (local mode needs none) and point pools; builds pairs excluding keys already in the generated list.
2. Resolves point modes through `tripModes.ts`: D takes precedence over C, then C+T, then T. Both endpoint orders use the same rule; C+T means bike access at the origin only. The library API retains explicit overrides for compatibility, but the app always passes `point_modes`.
3. With `automaticTransit: true` (all app calls), searches candidate stops near each actual point, ignoring area centers. `automaticTransit.ts` weights walking distance 3×, uses a 1,500 m distance-equivalent boarding penalty, validates ORS walks and reranks/excludes candidates. Access walks include endpoint gaps in their distance limit. Up to 12 refinements bound requests; public-service failures abort retries. Transit never falls back to physical tracks. Legacy station-based helpers remain for older library callers/tests.
4. Driving requests ORS alternatives once per unique pair and selects one. Cycling requests `cycling-regular` geometry per actual pair. Cycling + transit restricts first boarding to RER, weights cycling distance 1× and walks 3×, verifies routed bike access against its separate limit, then uses ordinary transit/walking egress. Parking is an explicit unverified assumption; no bike carriage or destination bike is inferred.
5. Assembles geometry and enriched GPX. Walking/cycling/driving directions request elevation directly. GPX serialization loads only when generating.

Successful trips append to the in-memory list; previews and ZIP downloads use that full list. Deleting trips frees their pair keys for later generation. Reload clears trips. Full reset also clears persisted state.

The app-owned route cache is bounded and page-session-only; reload/full reset clears it. Metro setup and walking-leg keys use exact ordered coordinates and routing/query parameters, not mutable IDs. Store only successful valid geometry. Cache and rendering details belong in [PERFORMANCE.md](PERFORMANCE.md); XML semantics belong in [GPX_EXPORT.md](GPX_EXPORT.md).

## Transit dataset and legs

`scripts/build-transit-network.py` extracts metro/RER/Transilien/tram/bus service patterns, shapes and directed transfer pairs from a supplied IDFM ZIP using Python's standard library. It excludes TER, demand-only boarding and missing/misaligned shapes. Stops/lines without retained patterns are pruned; night bus services remain because schedules are not modeled. The distributed `public/data/idfm-transit.json` carries source hash, dates, processing counts and component licenses; its [notice](public/data/idfm-transit.LICENSE.md) gives rebuild instructions. ZIP inputs stay outside git.

`app.ts` lazy-loads the dataset when actual point pools include regional transit candidates; `generator.ts` accepts an injected network for offline tests. Loading failures are reported for transit while driving pairs can still succeed. Inside coverage, a missing itinerary is not replaced with unverified track routing.

The router follows directed service patterns and honors boarding/alighting restrictions and explicit transfers. Automatic destination labels distinguish alighting from transfer arrivals, so cheaper ineligible transfer arrivals cannot suppress a valid endpoint. Automatic routing supplies candidate costs for all in-range platforms and routes access directly to boarding stops. Legacy callers use the nearest station group within 350 m. Costs are distance preferences, not travel times. Pattern changes count as another boarding even on the same line.

`transitJourney.legs` is ordered and retains line/stop IDs, mode, coordinates and geometry provenance. Same-station/short transfer links use approximate connectors; outdoor transfers over 350 m use ORS, with bounded connectors for street snapping. Walking endpoints over 500 m from their intended station fail visibly. Transit shapes remain 2D rather than acquiring misleading surface elevations. Hosted access/egress walks keep ORS elevation; local street routes are 2D. Shared itinerary arrays support preview deduplication; automatic journeys reuse graph preprocessing and cached walking geometry. Legacy resolved itineraries retain their snapshot/station-coordinate cache.

## Interaction and address lookup

Map-click rules live in `interaction.ts`: selection, area/point creation, adding area points, moving one point and moving a whole place are separate intents. Explicit creation permits overlapping areas; insertion prioritizes the selected area. Single-point places have no sampling circle. Place selection changes editing focus only; From/To assignment and swapping are explicit. The alphabetical library uses a DOM-preserved name filter and one editor; progress/clock patches retain active controls. Map tooltips use text nodes for untrusted labels.

Selecting a trip in the list highlights it and focuses its bounds. Clicking a trajectory selects and reveals its row without changing the map view or triggering editing; repeat clicks retain selection. Shared preview segments select the first owning trip in list order, while the selected overlay retains its trip identity. Transit rows expose selected stops and measured street access/exit walk distance (excluding station connectors and interchanges).

`lookupAddresses` defaults true. When off, new/moved points become `skipped` with coordinate labels; resolved labels remain until moved. Toggling off, moving/deleting points and resetting abort obsolete debounce, queued and active reverse work. Per-request identity plus point existence/coordinate guards reject stale callbacks/results across off/on. Re-enabling affects future edits only. Explicit forward search remains available.

Forward search and reverse lookup share one serialized, rate-limited Nominatim queue. Explicit searches precede queued background work without bypassing concurrency limits. Forward search uses a bounded five-minute cache keyed by query/options/coarse viewbox. Map bounds bias candidates; ranking groups visible, nearby, then elsewhere results. Public Nominatim search is user-triggered, with no autocomplete; provider references are in [SOURCES.md](SOURCES.md).

Rail-way queries to the default Overpass endpoint may try one sequential backup, `overpass.private.coffee`, after transient failure. Station discovery and custom endpoints do not use that fallback. Service errors remain visible; retry/error presentation traps are in [LESSONS.md](LESSONS.md).

## Build and deploy

- `.node-version` pins the runtime; `package.json` owns supported engines and commands. `npm run check` runs tests, TypeScript/Vite build and initial-bundle budget.
- `vite.config.ts` uses relative base `./` for project-path hosting, fixed loopback ports and `strictPort`; changing host/port changes saved-state origin.
- `.github/workflows/check.yml` checks pull requests. `.github/workflows/deploy.yml` checks `master` pushes before uploading `dist/` and deploying Pages; write/token permissions are scoped to the deploy job.
- For an authorized release, verify the workflow for the pushed commit and the served production asset. A local build or successful push alone does not establish deployment.

## Local street routing

`routingProvider` persists `hosted` (default) or `local`. `OrsClient` fixes local directions to `http://127.0.0.1:8082/ors/v2/directions`, omits Authorization and requests no elevation. Local mode cannot invoke hosted elevation. Street-access cache identity includes provider URL, elevation and profile; changing provider clears the app cache. Rebuilding local graphs requires restarting/reloading the app to discard old cached geometry.

`scripts/ors-install.mjs` installs the versioned inputs in `scripts/ors-inputs.json` with SHA-256/size verification and atomic publication; it reuses matching files and refuses replacements. `scripts/local-ors.mjs` manages a project-owned Java process with an 8 GB heap ceiling; `scripts/ors-config.yml` configures loopback, local-origin CORS and three profiles. `.local-ors/` is ignored and holds binaries, source PBF/checksums, graphs, PID metadata and logs. No login daemon or container runtime is installed. `npm run ors:benchmark -- 1000` explicitly exercises only the local server with distinct endpoint coordinates; it is excluded from automated checks. See [OFFLINE_ROUTING.md](OFFLINE_ROUTING.md) for operations and measurements.
