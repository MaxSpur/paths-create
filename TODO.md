# TODO

## Current Backlog

- [ ] Add Overpass mirror presets and endpoint fallback sequencing.
- [ ] Add station import/export JSON for sharing curated station and point pools.
- [ ] Decide whether generated preview trails should be cleared on regeneration or preserved as run history layers.
- [ ] Improve OSM station discovery filters so broad railway station results are easier to curate.
- [ ] Add lightweight app-level render tests if more `app.ts` render scheduling is changed.

## Recently Done

- [x] Split useful `CODEX_MEMO.md` facts into durable project docs.
- [x] Added a local project `AGENTS.md`.
- [x] Hardened panel rendering by centralizing HTML escaping.
- [x] Replaced rail shortest-path unvisited scans with a min-priority queue.
- [x] Added a top-right map location search control.
- [x] Fixed point address clock updates so they no longer reset station-list scroll or active radius slider interactions.
- [x] Refined `README.md` usage instructions around the actual panel/map workflow.
