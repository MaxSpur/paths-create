# AGENTS.md

## Project Scope

Origin-Destination Creator is a browser-only Vite/TypeScript app for creating synthetic origin-to-destination GPX tracks. It combines manually curated walking point pools, OpenStreetMap/Overpass rail geometry, and openrouteservice walking/elevation data.

There is no backend. Treat the browser as the whole runtime, and do not introduce server-side dependencies unless the project direction explicitly changes.

## First Reads

- Read `ARCHITECTURE.md` before changing core behavior.
- Read `TODO.md` for current backlog and recent work.
- Read `LESSONS.md` before touching map interactions, station radii, panel rendering, or address lookup behavior.
- Read `SOURCES.md` when external service assumptions, quotas, or documentation are relevant.
- Use `README.md` as the user-facing contract for setup and app behavior.

## Commands

- Install: `npm install`
- Dev server: `npm run dev`
- Tests: `npm run test:run`
- Build: `npm run build`

Run `npm run test:run` for most code changes. Run `npm run build` before declaring TypeScript/build safety. For UI work, also inspect the app in a browser when the change affects layout or interactions.

## Code Boundaries

- Keep domain logic in `src/lib/` where practical. Prefer pure helpers with focused tests.
- Keep Leaflet-specific rendering and map imperative behavior in `src/ui/map.ts`.
- Keep app orchestration, local UI state, async workflows, and persistence wiring in `src/ui/app.ts`.
- Keep panel markup and event binding in `src/ui/panel.ts`; escape every dynamic string rendered through `innerHTML` with `src/ui/html.ts`.
- Keep map-click intent logic in `src/ui/interaction.ts` so it remains testable without Leaflet.
- Do not store generated JS in `src/`; TypeScript configs use `noEmit: true`.

## State And Data

- Persistent browser state key: `odc.generator.state.v1`.
- Normalize loaded state through `src/lib/stateStore.ts`; do not trust localStorage shape or IDs.
- If persisted state changes incompatibly, update the schema/version deliberately and document the migration path.
- Station radius helpers in `src/lib/stationRadius.ts` are the single source of truth for clamping, slider mapping, display, random point generation, and hit testing.

## External Services

- Mock `fetch` in tests. Do not hit public ORS or Overpass from automated tests.
- openrouteservice API keys are user-provided and stored only in browser localStorage.
- Overpass and ORS availability, quotas, and CORS behavior are external limits; surface failures clearly rather than hiding them.

## Project Memory

- Keep durable notes short and current in `ARCHITECTURE.md`, `TODO.md`, `LESSONS.md`, and `SOURCES.md`.
- `CODEX_MEMO.md` is local/private scratch space and is ignored by git. Do not rely on it as the durable project memory.
- Update the durable docs after meaningful architecture changes, behavior changes, or avoidable mistakes.
