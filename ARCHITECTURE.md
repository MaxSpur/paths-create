# ARCHITECTURE

## Overview

Origin-Destination Creator runs entirely in the browser. It lets a user curate stations and walking-access points on a Leaflet map, then generates GPX trips made from a walking approach, an OSM-derived rail segment, and a walking exit.

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
- Station library with station coordinates, radius, and walk point pools.
- Selected origin and destination stations.
- Generation controls such as trip count, seed, and pairing mode.
- UI state including active station, selected point, map center, and map zoom.

All loaded state is normalized through `stateStore.ts`. Invalid station selections and invalid selected points are cleared during normalization.

## Generation Pipeline

`generateTrips` performs the core workflow:

1. Validate ORS key and point pools.
2. Fetch rail ways from Overpass for a corridor bbox around the selected stations.
3. Build a rail graph, snap each station to nearby rail nodes, and compute the shortest rail path.
4. Drape the rail path with ORS elevation in batched line requests.
5. Build anti-repeat origin/destination point pairings.
6. Fetch walking legs from ORS with retry/backoff.
7. Assemble trip geometries and serialize one GPX file per generated trip.

Walking directions request elevation directly from ORS. Rail elevation is added through ORS line draping because OSM rail geometry has no elevation.

## Interaction Model

- The map has a top-right location search control for quickly moving the map to a Nominatim result.
- The active station determines which walk points are shown and edited.
- Existing station clicks activate that station in any mode.
- Existing walk point clicks select or deselect that point.
- `add_point` mode adds or moves points only inside the active station radius.
- Clicking outside the active station radius deselects the selected point before any other add action.
- `add_station` mode adds stations only outside all existing station radii.

The pure rules live in `src/ui/interaction.ts`; keep behavior changes there first and cover them with unit tests.

## Address Lookup

New and moved walk points start with `addressStatus: "resolving"`. `app.ts` schedules reverse-geocode refreshes through `src/lib/geocode.ts`, with debouncing for moved points and serialized/rate-limited request execution. The panel renders compact clock states for debounce, queue, and active lookup phases.

Point-clock tick updates patch existing clock DOM through `updatePointClocks`; do not route timer ticks through a full `renderPanel` call because that can disrupt station-list scroll and active form controls.

## Build And Deploy

- Vite base path is `./` so built assets work under a GitHub Pages project path.
- GitHub Pages deployment is configured in `.github/workflows/deploy.yml`.
- Deployment builds `dist/` with `npm ci` and `npm run build`.

## Known Constraints

- ORS and Overpass quotas, CORS behavior, downtime, and rate limits are external constraints.
- OSM station discovery is heuristic and can include non-metro rail stations.
- The rail segment is geometry-based only; there is no GTFS or timetable integration.
- API keys and curated data are stored locally in the user's browser.
