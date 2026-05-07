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
- `src/lib/stateStore.ts`: state creation, localStorage persistence, and normalization.
- `src/lib/generator.ts`: trip generation pipeline.
- `src/lib/orsClient.ts`: ORS walking routes, retries, and elevation draping.
- `src/lib/overpassClient.ts`: Overpass station and rail queries.
- `src/lib/geocode.ts`: Nominatim-backed forward location search and reverse walk-point label lookup with serialized/rate-limited requests.
- `src/lib/railGraph.ts`: rail graph construction, station snapping, and shortest path search.
- `src/lib/gpxWriter.ts` and `src/lib/exportZip.ts`: GPX serialization and ZIP download.
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
2. Build anti-repeat origin/destination point pairings.
3. Split pairs into metro trips and driving trips. Any pair containing a `driving` point becomes a direct driving trip.
4. For metro trips, fetch rail ways from Overpass, build the rail graph, snap stations to rail nodes, compute the shortest rail path, and drape the rail path with ORS elevation.
5. For metro trips, fetch walking legs from ORS with retry/backoff.
6. For driving trips, fetch ORS driving alternatives once per unique point pair and randomly choose an available alternative per generated trip.
7. Assemble trip geometries and serialize one GPX file per generated trip.

Walking and driving directions request elevation directly from ORS. Rail elevation is added through ORS line draping because OSM rail geometry has no elevation.

## Interaction Model

- The map has a top-right location search control that returns a ranked candidate list. Search requests use the current visible map bounds as a Nominatim `viewbox` bias, then the client sorts results into visible, nearby expanded bounds, and elsewhere buckets.
- The active station determines which walk points are shown and edited.
- Existing station clicks activate that station in any mode.
- Existing walk point clicks select or deselect that point.
- Active station point rows have an `M`/`D` toggle. `M` keeps the point on the metro pipeline; `D` makes generated pairs containing that point use direct driving.
- `add_point` mode adds or moves points only inside the active station radius.
- Clicking outside the active station radius deselects the selected point before any other add action.
- `add_station` mode adds stations only outside all existing station radii.

The pure rules live in `src/ui/interaction.ts`; keep behavior changes there first and cover them with unit tests.

## Address Lookup

New and moved walk points start with `addressStatus: "resolving"`. `app.ts` schedules reverse-geocode refreshes through `src/lib/geocode.ts`, with debouncing for moved points and serialized/rate-limited request execution. The panel renders compact clock states for debounce, queue, and active lookup phases.

Point-clock tick updates patch existing clock DOM through `updatePointClocks`; do not route timer ticks through a full `renderPanel` call because that can disrupt station-list scroll and active form controls.

Public Nominatim does not support client-side autocomplete. Keep search user-triggered unless the project switches to a provider or self-hosted service that explicitly supports autocomplete.

## Build And Deploy

- Vite base path is `./` so built assets work under a GitHub Pages project path.
- GitHub Pages deployment is configured in `.github/workflows/deploy.yml`.
- Deployment builds `dist/` with `npm ci` and `npm run build`.

## Known Constraints

- ORS and Overpass quotas, CORS behavior, downtime, and rate limits are external constraints.
- OSM station discovery is heuristic and can include non-metro rail stations.
- The rail segment is geometry-based only; there is no GTFS or timetable integration.
- API keys and curated data are stored locally in the user's browser.
