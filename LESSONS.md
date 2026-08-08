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
- Keep point-row controls compact. The row now prioritizes the `M`/`D` route-mode toggle and delete action over manual ordering.
- Do not rebuild the panel or Leaflet layers for progress-only updates. Patch the progress DOM and let synchronous data invalidations coalesce.
- Keep station, point, and preview layer invalidation independent. A map-view persistence update does not change any of those layers.
- Generated metro trips intentionally share route arrays. Deduplicate preview segments by array identity and draw the selected trip as a separate overlay.

## Generation Modes

- Treat per-point `driving` mode as a pair-level override: any generated pair containing a driving point should become a direct point-to-point driving trip.
- Request ORS driving alternatives once per unique driving pair, then randomly choose among returned alternatives per generated trip to increase variety without multiplying API calls.
- Do not replace or clear previously generated successful trips during a new generation run. Append only new pair keys and let the user delete generated trips explicitly.

## Export Format

- Keep transport semantics explicit in GPX exports. Use GPX tracks and `odc` extensions rather than relying on implicit track-segment order.
- Preserve structured address components when reverse geocoding provides them; labels alone are useful for humans but weak for downstream tooling.

## Async Address Lookup

- Debounce address refreshes after moving a point; each move should reset the pending lookup.
- Keep reverse-geocode requests serialized and rate-limited so bulk random point creation does not overwhelm the public service.
- Forward location search shares the geocode queue with reverse lookup, so UI code should show searching/queued feedback rather than assuming an instant response.
- Explicit forward search takes priority over queued background reverse lookups but still obeys the same single-request rate limiter.
- Cache only bounded, recent forward searches. Include the coarse viewbox in the key so map-biased results are not reused in the wrong area.
- Do not implement client-side autocomplete against public Nominatim. Use explicit user-triggered search with a candidate list, or switch to a provider/self-hosted service that allows autocomplete.

## Build Hygiene

- Keep `noEmit: true` in the TypeScript configs so builds do not create stray JS files in `src/`.
- Mock network clients in tests; do not depend on live ORS or Overpass availability for verification.
- Use `npm ci` to reproduce the lockfile, including platform optional dependencies. Do not delete the lockfile to repair a missing Rollup/Rolldown package.
- Keep the fixed strict dev/preview ports. Silent port fallback changes the localStorage origin and makes saved state appear missing.
- Retry only network failures, HTTP 429, and 5xx responses. Authentication and other non-retriable 4xx errors must fail once and remain visible.
- Use warmup plus repeated median/p95 measurements for performance work. Keep live service latency separate from deterministic CPU/DOM benchmarks.
- Lazy-load features that are not needed at startup, and enforce the initial gzip budget after every production build.
