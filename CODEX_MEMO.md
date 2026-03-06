# CODEX_MEMO

## CURRENT_TASK
Add elevation draping to generated paths and emit GPX `<ele>` tags.

## CURRENT_SUBTASK
Completed ORS-backed elevation draping for walking + rail segments and GPX `<ele>` export; verified with `npm run test:run` and `npm run build`.

## ARCHITECTURE_FACTS
- App is fully browser-only (no backend).
- Persistent state key: `odc.generator.state.v1`.
- State schema includes API key, station library, per-station point pools, origin/destination selections, generation controls, and map UI state.
- UI structure:
  - `src/ui/map.ts` handles Leaflet map interactions/layers.
  - `src/ui/panel.ts` handles station/point/generation controls.
  - `src/ui/app.ts` orchestrates state, async actions, and rendering.
- Generation pipeline (`src/lib/generator.ts`):
  1. Fetch rail network from Overpass in corridor bbox.
  2. Build rail graph and compute shortest station-to-station path.
  3. Drape the shared rail path through ORS elevation in one batched call (chunked at 2000 vertices with overlap stitching).
  4. Build anti-repeat pair list from origin/destination station point pools.
  5. Fetch walking legs from ORS (retry/backoff, `elevation: true`).
  6. Compose 3-segment trips and serialize GPX with `<ele>` when available.
- Elevation strategy:
  - walking directions can request 3D coordinates from ORS directly,
  - rail middle segment has no elevation in OSM and should be draped separately,
  - ORS/openelevationservice can drape the rail LineString in one batched call instead of per-point requests,
  - local-only draping is not present in this repo; self-hosting ORS/openelevationservice would be the local path if needed later.
- Export path: GPX files are downloaded as ZIP via `src/lib/exportZip.ts`.
- TS build safety:
  - `tsconfig.app.json` and `tsconfig.node.json` set `noEmit: true` to prevent accidental JS output into `src/`.
- GitHub Pages deploy workflow is defined in `.github/workflows/deploy.yml`:
  - triggers on `push` to `main`/`master` and manual dispatch,
  - builds with `npm ci` + `npm run build`,
  - deploys `dist/` using `actions/upload-pages-artifact` and `actions/deploy-pages`.
- Vite base path is `./` in `vite.config.ts` to keep assets working on project Pages URLs.
- Point editing behavior:
  - no editable lat/lon fields for stations or walk points in UI,
  - clicking existing map station always sets active station (mode-independent),
  - clicking existing walk point selects/deselects it (mode-independent),
  - selected walk point can be moved by clicking another map location,
  - selected walk point can be deleted with Delete/Backspace (when focus is not in an input).
- UI persistence includes `ui.selectedPointId` in localStorage state.
- Address labels:
  - walk-point labels are read-only in UI,
  - labels are resolved via reverse geocoding (`src/lib/geocode.ts`) on creation,
  - moving a selected point debounces address lookup by 2 seconds; each move resets the timer.
  - reverse-geocode requests are serialized and rate-limited to at most one request every 2 seconds.
- Point status and feedback:
  - points carry `addressStatus` (`resolving|resolved|failed`) in persisted state,
  - active station list uses compact clock chips for unresolved points:
    - `D` countdown for debounce delay,
    - `Q` countdown/elapsed indicator for queue waiting,
    - `lookup` animated dial while reverse-geocode request is actively in-flight,
    - latest UI version uses tiny analog-style circular timers instead of text pills,
    - timer is rendered in a fixed position left of action buttons using an inner actions wrapper to avoid table-line artifacts/layout shift.
- Generation progress UX:
  - `generateTrips` emits progress phases (`setup`, `walking`, `assemble`, `done`),
  - panel renders a live generation-process card with phase message + progress bar,
  - final generation report is embedded in that same process card (not separate).
- Selecting a point from the list now pans the map to that point.
- Selecting a point on the map now triggers one-shot `scrollIntoView` for its list row; list clicks do not auto-scroll.

## KNOWN_LIMITS
- ORS and Overpass CORS/rate limits are external constraints.
- OSM station query currently broad and may include non-metro rail stations; filtered by likely metro tags but still heuristic.
- No explicit GTFS/transit schedule integration; metro leg is geometry-based only.

## NEXT_DECISIONS
- Add Overpass mirror presets and endpoint fallback sequence.
- Add station import/export JSON to share curated point pools.
- Decide whether to keep preview trails after regeneration or separate run history layers.
