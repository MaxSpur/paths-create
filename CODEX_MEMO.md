# CODEX_MEMO

## CURRENT_TASK
Enable GitHub Pages self-deployment via GitHub Actions for the browser-only app.

## CURRENT_SUBTASK
Workflow and Vite config updated; running verification.

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
  3. Build anti-repeat pair list from origin/destination station point pools.
  4. Fetch walking legs from ORS (retry/backoff).
  5. Compose 3-segment trips and serialize GPX.
- Export path: GPX files are downloaded as ZIP via `src/lib/exportZip.ts`.
- TS build safety:
  - `tsconfig.app.json` and `tsconfig.node.json` set `noEmit: true` to prevent accidental JS output into `src/`.
- GitHub Pages deploy workflow is defined in `.github/workflows/deploy.yml`:
  - triggers on `push` to `main`/`master` and manual dispatch,
  - builds with `npm ci` + `npm run build`,
  - deploys `dist/` using `actions/upload-pages-artifact` and `actions/deploy-pages`.
- Vite base path is `./` in `vite.config.ts` to keep assets working on project Pages URLs.

## KNOWN_LIMITS
- ORS and Overpass CORS/rate limits are external constraints.
- OSM station query currently broad and may include non-metro rail stations; filtered by likely metro tags but still heuristic.
- No explicit GTFS/transit schedule integration; metro leg is geometry-based only.

## NEXT_DECISIONS
- Add Overpass mirror presets and endpoint fallback sequence.
- Add station import/export JSON to share curated point pools.
- Decide whether to keep preview trails after regeneration or separate run history layers.
