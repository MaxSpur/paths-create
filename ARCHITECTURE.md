# Architecture

The browser is the whole runtime. `src/main.ts` mounts `createApp`; Leaflet displays curated station/point pools and generated GPX trips. Île-de-France uses a static GTFS-derived service network; other regions retain OSM track routing. Neither models schedules.

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
| Radius, sampling, pairing and coordinate helpers | `src/lib/stationRadius.ts`, `sampling.ts`, `pairing.ts`, `geo.ts` |

## State and generation

`odc.generator.state.v1` stores service settings/ORS key, station coordinates/radii, access-point pools and per-point `metro`/`driving` modes, origin/destination selections, generation controls and map/UI state. Normalization clears invalid station/point selections.

`generateTrips`:

1. Validates the ORS key and point pools; builds pairs excluding keys already in the generated list.
2. Uses direct driving when either point has `driving` mode; the persisted `metro` value now means transit (the UI uses `T`).
3. In Île-de-France, routes through directed stop occurrences on service patterns, honoring boarding/alighting restrictions and explicit transfers. Elsewhere, reuses rail setup/elevation or fetches Overpass ways and routes the physical graph. Successful walking legs are reused; misses request ORS.
4. For driving, requests ORS alternatives once per unique pair within the run and randomly selects an available alternative.
5. Assembles geometry and enriched GPX. Walking/driving directions request elevation directly.

Successful trips append to the in-memory list; previews and ZIP downloads use that full list. Deleting trips frees their pair keys for later generation. Reload clears trips. Full reset also clears persisted state.

The app-owned route cache is bounded and page-session-only; reload/full reset clears it. Metro setup and walking-leg keys use exact ordered coordinates and routing/query parameters, not mutable IDs. Store only successful valid geometry. Cache and rendering details belong in [PERFORMANCE.md](PERFORMANCE.md); XML semantics belong in [GPX_EXPORT.md](GPX_EXPORT.md).

## Transit dataset and legs

`scripts/build-transit-network.py` extracts metro/RER/Transilien/tram service patterns, shapes and directed transfer pairs from a supplied IDFM ZIP using Python's standard library. It excludes TER and rejects missing/misaligned shapes. The distributed `public/data/idfm-transit.json` carries source hash, dates, processing counts and component licenses; its [notice](public/data/idfm-transit.LICENSE.md) gives rebuild instructions. ZIP inputs stay outside git.

`app.ts` lazy-loads the dataset for regional transit pairs; `generator.ts` accepts an injected network for offline tests. Loading failures are reported for transit while driving pairs can still succeed. Inside coverage, a missing itinerary is not replaced with unverified track routing.

The router anchors endpoints to the nearest station group within 350 m, follows directed service patterns and allows up to three changes. It minimizes geometry distance with a 1,500 m distance-equivalent penalty per additional boarding; this is not travel time. Identical station groups do not generate train loops. Pattern changes count as another boarding even on the same line.

`transitJourney.legs` is ordered and retains line/stop IDs, mode, coordinates and geometry provenance. Same-station/short transfer links use approximate connectors; outdoor transfers over 350 m use ORS, with bounded connectors for street snapping. Walking endpoints over 500 m from their intended station fail visibly. Transit shapes remain 2D rather than acquiring misleading surface elevations. Access/egress walks keep ORS elevation. Shared itinerary arrays support preview deduplication; successful resolved itineraries are cached by snapshot version and station coordinates.

## Interaction and address lookup

Map-click rules live in `interaction.ts`: station clicks activate; point clicks select/deselect; add-point mode adds/moves only inside the active station radius. Another station's radius activates that station; otherwise an outside click deselects the selected point before adding anything. Add-station mode requires a location outside existing station radii. Point modes use orange (metro) and purple (driving); selecting a generated trip in the list highlights it and focuses its bounds. Clicking a trajectory selects and reveals its list row without changing the map view or triggering point editing; repeat clicks retain selection. Shared preview segments select the first owning trip in list order, while the selected overlay retains its trip identity.

New/moved points start resolving. `app.ts` debounces refreshes and checks point existence/coordinates before applying responses. Already queued reverse work is not canceled; see [TODO.md](TODO.md).

Forward search and reverse lookup share one serialized, rate-limited Nominatim queue. Explicit searches precede queued background work without bypassing concurrency limits. Forward search uses a bounded five-minute cache keyed by query/options/coarse viewbox. Map bounds bias candidates; ranking groups visible, nearby, then elsewhere results. Public Nominatim search is user-triggered, with no autocomplete; provider references are in [SOURCES.md](SOURCES.md).

Rail-way queries to the default Overpass endpoint may try one sequential backup, `overpass.private.coffee`, after transient failure. Station discovery and custom endpoints do not use that fallback. Service errors remain visible; retry/error presentation traps are in [LESSONS.md](LESSONS.md).

## Build and deploy

- `.node-version` pins the runtime; `package.json` owns supported engines and commands. `npm run check` runs tests, TypeScript/Vite build and initial-bundle budget.
- `vite.config.ts` uses relative base `./` for project-path hosting, fixed loopback ports and `strictPort`; changing host/port changes saved-state origin.
- `.github/workflows/check.yml` checks pull requests. `.github/workflows/deploy.yml` checks `master` pushes before uploading `dist/` and deploying Pages; write/token permissions are scoped to the deploy job.
- For an authorized release, verify the workflow for the pushed commit and the served production asset. A local build or successful push alone does not establish deployment.
