# Architecture

The browser is the whole runtime. `src/main.ts` mounts `createApp`; Leaflet displays curated station/point pools and generated GPX trips. Rail routing follows OSM geometry, without schedules or GTFS.

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
| Routing/elevation, rail queries, search/address queue | `src/lib/orsClient.ts`, `src/lib/overpassClient.ts`, `src/lib/geocode.ts` |
| Rail graph, station snapping and shortest paths | `src/lib/railGraph.ts` |
| GPX serialization and lazy ZIP export | `src/lib/gpxWriter.ts`, `src/lib/exportZip.ts` |
| Radius, sampling, pairing and coordinate helpers | `src/lib/stationRadius.ts`, `sampling.ts`, `pairing.ts`, `geo.ts` |

## State and generation

`odc.generator.state.v1` stores service settings/ORS key, station coordinates/radii, access-point pools and per-point `metro`/`driving` modes, origin/destination selections, generation controls and map/UI state. Normalization clears invalid station/point selections.

`generateTrips`:

1. Validates the ORS key and point pools; builds pairs excluding keys already in the generated list.
2. Uses direct driving when either point has `driving` mode; all other pairs use walking–rail–walking.
3. For metro, reuses matching rail setup/elevation or fetches Overpass ways, builds/snaps/routes the graph and drapes rail elevation with ORS. Successful walking legs are reused; misses request ORS walking directions.
4. For driving, requests ORS alternatives once per unique pair within the run and randomly selects an available alternative.
5. Assembles geometry and enriched GPX. Walking/driving directions request elevation directly.

Successful trips append to the in-memory list; previews and ZIP downloads use that full list. Deleting trips frees their pair keys for later generation. Reload clears trips. Full reset also clears persisted state.

The app-owned route cache is bounded and page-session-only; reload/full reset clears it. Metro setup and walking-leg keys use exact ordered coordinates and routing/query parameters, not mutable IDs. Store only successful valid geometry. Cache and rendering details belong in [PERFORMANCE.md](PERFORMANCE.md); XML semantics belong in [GPX_EXPORT.md](GPX_EXPORT.md).

## Interaction and address lookup

Map-click rules live in `interaction.ts`: station clicks activate; point clicks select/deselect; add-point mode adds/moves only inside the active station radius. Another station's radius activates that station; otherwise an outside click deselects the selected point before adding anything. Add-station mode requires a location outside existing station radii. Point modes use orange (metro) and purple (driving); selecting a generated trip highlights it and focuses its bounds.

New/moved points start resolving. `app.ts` debounces refreshes and checks point existence/coordinates before applying responses. Already queued reverse work is not canceled; see [TODO.md](TODO.md).

Forward search and reverse lookup share one serialized, rate-limited Nominatim queue. Explicit searches precede queued background work without bypassing concurrency limits. Forward search uses a bounded five-minute cache keyed by query/options/coarse viewbox. Map bounds bias candidates; ranking groups visible, nearby, then elsewhere results. Public Nominatim search is user-triggered, with no autocomplete; provider references are in [SOURCES.md](SOURCES.md).

Rail-way queries to the default Overpass endpoint may try one sequential backup, `overpass.private.coffee`, after transient failure. Station discovery and custom endpoints do not use that fallback. Service errors remain visible; retry/error presentation traps are in [LESSONS.md](LESSONS.md).

## Build and deploy

- `.node-version` pins the runtime; `package.json` owns supported engines and commands. `npm run check` runs tests, TypeScript/Vite build and initial-bundle budget.
- `vite.config.ts` uses relative base `./` for project-path hosting, fixed loopback ports and `strictPort`; changing host/port changes saved-state origin.
- `.github/workflows/check.yml` checks pull requests. `.github/workflows/deploy.yml` checks `master` pushes before uploading `dist/` and deploying Pages; write/token permissions are scoped to the deploy job.
- For an authorized release, verify the workflow for the pushed commit and the served production asset. A local build or successful push alone does not establish deployment.
