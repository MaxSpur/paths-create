# ARCHITECTURE

## Overview

Origin-Destination Creator runs entirely in the browser. It lets a user curate stations and access points on a Leaflet map, then generates GPX trips made from either a walking approach plus OSM-derived rail segment plus walking exit, or a direct ORS driving route between paired points.

Runtime entry: `src/main.ts` mounts `createApp` from `src/ui/app.ts`.

## Main Modules

- `src/ui/app.ts`: application orchestration, local UI state, async workflows, reverse-geocode scheduling, generation progress, downloads, and rendering coordination.
- `src/ui/map.ts`: Leaflet map setup and rendering for stations, radii, active point markers, and generated route previews.
- `src/ui/panel.ts`: sidebar HTML rendering and DOM event binding.
- `src/ui/html.ts`: shared HTML escaping for dynamic panel template content.
- `src/ui/interaction.ts`: pure map-click intent resolution for station activation, point add/move/deselect, and station creation.
- `src/ui/previewSegments.ts`: pure preview-segment deduplication before Leaflet rendering.
- `src/ui/renderScheduler.ts`: microtask coalescing for synchronous UI invalidations.
- `src/lib/stateStore.ts`: state creation, localStorage persistence, and normalization.
- `src/lib/generator.ts`: trip generation pipeline.
- `src/lib/orsClient.ts`: ORS walking routes, retries, and elevation draping.
- `src/lib/overpassClient.ts`: Overpass station and rail queries.
- `src/lib/geocode.ts`: Nominatim-backed forward location search and reverse walk-point label lookup with serialized/rate-limited requests.
- `src/lib/railGraph.ts`: rail graph construction, station snapping, and shortest path search.
- `src/lib/gpxWriter.ts` and `src/lib/exportZip.ts`: enriched GPX serialization and ZIP download.
- `src/lib/stationRadius.ts`, `src/lib/sampling.ts`, `src/lib/pairing.ts`, `src/lib/geo.ts`: focused domain helpers with tests.

## State Model

State is persisted in localStorage under `odc.generator.state.v1`.

The persisted model includes:

- ORS API key and Overpass URL.
- Station library with station coordinates, radius, point pools, and per-point route mode (`metro` or `driving`).
- Selected origin and destination stations.
- Generation controls such as trip count, seed, and pairing mode.
- UI state including active station, selected point, map center, and map zoom.

All loaded state is normalized through `stateStore.ts`. Invalid station selections and invalid selected points are cleared during normalization.

## Generation Pipeline

`generateTrips` performs the core workflow:

1. Validate ORS key and point pools.
2. Build unused origin/destination point pairings, excluding pair keys already present in the generated-trip list.
3. Split pairs into metro trips and driving trips. Any pair containing a `driving` point becomes a direct driving trip.
4. For metro trips, fetch rail ways from Overpass, build the rail graph, snap stations to rail nodes, compute the shortest rail path, and drape the rail path with ORS elevation.
5. For metro trips, fetch walking legs from ORS with retry/backoff.
6. For driving trips, fetch ORS driving alternatives once per unique point pair and randomly choose an available alternative per generated trip.
7. Assemble trip geometries and serialize one enriched GPX file per generated trip.

Walking and driving directions request elevation directly from ORS. Rail elevation is added through ORS line draping because OSM rail geometry has no elevation.

Generated trips are kept in an in-memory UI list for the current page session. New generation runs append successful trips to that list and do not remove older successful routes. The app derives map previews and ZIP downloads from the full generated-trip list.

## GPX Export Contract

GPX files are standard GPX 1.1 with project-specific metadata in the `odc` namespace. Metro trips export one GPX track per leg (`walking`, `metro`, `walking`); driving trips export one `driving` track. Each track has one `trkseg`, explicit `<type>`, `odc:segment` metadata, and a segment-level `odc:segmentRef`. Trip metadata includes station IDs, point IDs, point route modes, labels, and structured address components when available.

Keep [GPX_EXPORT.md](GPX_EXPORT.md) in sync with `src/lib/gpxWriter.ts` whenever the exported XML contract changes.

## Interaction Model

- The map has a top-right location search control that returns a ranked candidate list. Search requests use the current visible map bounds as a Nominatim `viewbox` bias, then the client sorts results into visible, nearby expanded bounds, and elsewhere buckets.
- The active station determines which walk points are shown and edited.
- Existing station clicks activate that station in any mode.
- Existing walk point clicks select or deselect that point.
- Active station point rows have an `M`/`D` toggle. `M` keeps the point on the metro pipeline; `D` makes generated pairs containing that point use direct driving.
- Active station map points encode route mode visually: metro points use the orange marker palette, driving points use purple/violet.
- Generated trips are listed in the sidebar. Selecting a trip highlights it on the map and focuses the map to its bounds; individual trips or the full generated list can be deleted.
- `add_point` mode adds or moves points only inside the active station radius.
- Clicking outside the active station radius deselects the selected point before any other add action.
- `add_station` mode adds stations only outside all existing station radii.

The pure rules live in `src/ui/interaction.ts`; keep behavior changes there first and cover them with unit tests.

## Address Lookup

New and moved walk points start with `addressStatus: "resolving"`. `app.ts` schedules reverse-geocode refreshes through `src/lib/geocode.ts`, with debouncing for moved points and serialized/rate-limited request execution. The panel renders compact clock states for debounce, queue, and active lookup phases.

Point-clock tick updates patch existing clock DOM through `updatePointClocks`; do not route timer ticks through a full `renderPanel` call because that can disrupt station-list scroll and active form controls.

Public Nominatim does not support client-side autocomplete. Keep search user-triggered unless the project switches to a provider or self-hosted service that explicitly supports autocomplete.

Forward searches and reverse point lookups share one rate limiter to respect the public service. Explicit searches enter ahead of queued background lookups, and recent identical searches use a bounded five-minute cache. They never bypass the single-request concurrency limit.

## Rendering And Performance

- Synchronous render requests are coalesced into one microtask. Store subscriptions may still request a render, but callers do not cause duplicate immediate rebuilds.
- Generation progress patches the existing progress DOM. It does not rebuild the panel or Leaflet layers for each generated trip.
- Map layers have independent change keys. Station, active-point, and preview layers rebuild only when their own model changes.
- Preview geometry is deduplicated by shared coordinate-array identity. The selected trip is drawn once more as a highlighted overlay.
- Built rail graphs include a spatial lookup for station snapping. Shortest-path state is allocated lazily, and path reconstruction is linear.
- JSZip is loaded only when the user downloads a ZIP, keeping it out of the initial JavaScript payload.

Use `npm run benchmark` for deterministic CPU/DOM measurements and `npm run bundle:check` for the initial-payload budget. Treat live ORS, Overpass, tile, and Nominatim timings as service observations, not app CPU benchmarks. See `PERFORMANCE.md`.

## Build And Deploy

- Vite base path is `./` so built assets work under a GitHub Pages project path.
- Local development binds only to `127.0.0.1:5198`; preview uses `127.0.0.1:4198`. Both use `strictPort` so a collision cannot silently change the localStorage origin.
- Node 24 LTS is pinned in `.node-version`; package metadata also permits the currently tested Node 26 line.
- `npm run check` runs tests, the TypeScript/Vite build, and the initial-bundle budget.
- GitHub Pages deployment is configured in `.github/workflows/deploy.yml`.
- Pull requests run `.github/workflows/check.yml`. Pushes to `master` run the same gate before uploading `dist/` and deploying Pages.
- Pages write and identity-token permissions are limited to the deploy job.

## Known Constraints

- ORS and Overpass quotas, CORS behavior, downtime, and rate limits are external constraints.
- OSM station discovery is heuristic and can include non-metro rail stations.
- The rail segment is geometry-based only; there is no GTFS or timetable integration.
- API keys and curated data are stored locally in the user's browser.
- Local data is origin-scoped. A different host or port appears as a separate empty app state.
