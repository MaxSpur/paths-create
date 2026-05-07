# LESSONS

## Map And Radius Behavior

- Treat station radius as the single source of truth for add-point hit testing, random point generation, and visual radius display.
- Keep map-click decisions in `src/ui/interaction.ts`; it is easier to test there than through Leaflet events.
- Use `L.latLng(...).toBounds(...)` for station focus bounds. Detached `L.circle(...).getBounds()` can fail because the circle has no attached map.

## Panel Rendering

- `panel.ts` renders through `innerHTML`, so every dynamic string must be escaped with `escapeHtml` from `src/ui/html.ts`.
- Do not interpolate persisted IDs directly into selectors. LocalStorage can contain unexpected strings; prefer dataset iteration or explicit escaping.
- Do not use full panel re-renders for high-frequency point-clock ticks. Patch the existing clock dials so scroll positions and active controls remain stable.

## UI Responsiveness

- For station radius sliders, update the local readout on `input` and commit app state on `change`; committing on every drag step rerenders the whole panel.
- The address status clock should stay in fixed action space to avoid table layout shifts.

## Async Address Lookup

- Debounce address refreshes after moving a point; each move should reset the pending lookup.
- Keep reverse-geocode requests serialized and rate-limited so bulk random point creation does not overwhelm the public service.
- Forward location search shares the geocode queue with reverse lookup, so UI code should show searching/queued feedback rather than assuming an instant response.

## Build Hygiene

- Keep `noEmit: true` in the TypeScript configs so builds do not create stray JS files in `src/`.
- Mock network clients in tests; do not depend on live ORS or Overpass availability for verification.
