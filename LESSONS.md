# Regression traps

Keep only non-obvious failure modes here. Module ownership and product behavior live in [ARCHITECTURE.md](ARCHITECTURE.md); measurements in [PERFORMANCE.md](PERFORMANCE.md).

## Map and panel

- Use `L.latLng(...).toBounds(...)` for station focus. Detached `L.circle(...).getBounds()` can fail without an attached map.
- Radius sliders update their readout on `input` and commit state on `change`; committing each drag step rebuilds the control.
- Clock/progress ticks patch existing DOM. Full panel rebuilds disrupt scroll and active controls; keep clock space fixed to avoid layout shifts.
- Avoid interpolating persisted IDs into selectors; use dataset iteration or explicit escaping.
- When changing map/editing flows, verify the sequence (select, explicitly add versus move inside/outside radius, switch place, preserve From/To, deselect/delete), not just isolated clicks. Pure intent tests cannot prove Leaflet focus or control stability.
- Search changes need candidate selection, stale-result dismissal, Escape, accessibility state and narrow-screen control checks. Reuse the fixture in PERFORMANCE.

## Async and services

- Debouncing pending timers does not cancel queued/in-flight work. Preserve existence/coordinate guards for stale reverse-geocode results; cancellation must also keep clocks and queue feedback consistent.
- Preserve interactive search priority within the shared limiter; bypassing it creates public-service load even if the UI feels faster.
- Keep transient network/429/5xx retries bounded. Authentication failures must fail once; preserve the deliberate ORS alternatives-to-standard-directions fallback on 400/404/422. Overpass sanitizes upstream errors; ORS still includes response text, so do not assume every client does.
- Default-endpoint fallback must remain bounded/sequential and must not silently override custom endpoints.
- Check cold and warm generation, append and failure states when changing routing. Prior successes must survive failures; stale completion reports must not describe a failed new run.

## Transit graph

- When endpoint eligibility depends on arrival type, keep that distinction in shortest-path labels. A transfer arrival cannot dominate an alighting arrival if only the latter can end a journey. Test against the full snapshot as well as small fixtures.

## Setup and verification

- Repair missing platform optional dependencies with lockfile-faithful `npm ci --include=optional`; do not delete the lockfile.
- Tests use the explicit in-memory storage in `src/test/setup.ts`; do not depend on host Node localStorage behavior.
- Establish which checkout/process serves the fixed URL before browser verification. A different origin can make saved data appear lost.
