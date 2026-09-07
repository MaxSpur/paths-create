# Performance

## Measurement contract

Run `npm run benchmark` for offline rail-graph and panel-DOM fixtures. Establish a baseline before editing; use the same workload/environment, warmup and repeated measurements, reporting median/p95 where practical. Keep correctness checks alongside timing and separate live-service latency from app CPU/DOM work.

- `scripts/benchmarks/railGraph.bench.ts`: station snapping and shortest paths on 40k nodes.
- `scripts/benchmarks/panel.bench.ts`: full render versus progress patch.
- `npm run check`: tests, build and bundle budget.
- `scripts/check-bundle-size.mjs`: sums gzip bytes of JS/CSS directly referenced by `dist/index.html`, capped at 80,000 bytes. It does not recursively traverse imports; revisit coverage if chunk loading changes.

## Runtime constraints

- Coalesce synchronous UI invalidations into a microtask; patch progress and clock DOM.
- Invalidate station, active-point and preview layers independently. Map-view persistence alone must not rebuild them.
- Metro trips share coordinate arrays: deduplicate base preview segments by identity, then add one selected-trip overlay.
- Rail graphs use spatial lookup for snapping, lazy shortest-path state and linear path reconstruction.
- Load JSZip on download, outside the initial payload.
- `generationRouteCache.ts` bounds page-session reuse to 16 metro setups and 512 walking legs. Keys include exact ordered coordinates and applicable endpoint/profile/query parameters. Reset/reload clears it. Cache valid geometry only; successful rail geometry survives an elevation failure so elevation can be retried later.
- Search shares the Nominatim limiter; priority/cache improvements cannot guarantee live response time.

## Browser acceptance fixture

Reuse a small state around Vincennes (`48.847, 2.439`) and Géodata Paris in Champs-sur-Marne (`48.8411, 2.5874`). Check only flows affected by the change:

- Search both names, select the intended French result, verify map focus and result dismissal; check narrow-screen search/zoom controls.
- For generation, compare cold and warm append batches with a fixed seed and unchanged point pools. Record trip counts, visible progress/report, route reuse and failures.
- For previews, compare base Leaflet layer counts and selection overlays as trip count grows. Pure segment counts do not establish rendered layer counts.

Automated fixtures mock services. Live checks preserve curated user data and distinguish measured elapsed time from polling bounds. Queued reverse-lookup cancellation and lifecycle/layer-count coverage remain in [TODO.md](TODO.md); structural sidebar changes still rebuild the panel.

## Historical reference — 2026-08-08

macOS arm64, Node 26.3.0, npm 11.16.0. Baseline used Vitest 2.1.9/Vite 5.4.21; optimized work used Vitest 4.1.10/Vite 8.2.1. These are recorded observations, not current measurements or isolated dependency comparisons.

| Scenario | Before | After |
| --- | ---: | ---: |
| 40k-node graph, snap two stations | 4.652 ms mean | 0.0446 ms mean |
| 40k-node graph, connected-row path | 3.094 ms mean | 0.0250 ms mean |
| 90k-node line, worst-case path | 659 ms median | 24.86 ms median |
| 250-point/250-trip progress | 86.67 ms full render | 1.72 ms patch |
| 20×20 metro preview, unselected | 1,200 polylines | 41 unique polylines |
| Walking / driving-alternatives ORS 401 | 4 / 8 requests | 1 / 1 request |

The recorded initial JS+CSS payload after the route-cache follow-up was 71.8 KiB gzip. Read current size from the gate.

A live 20-point-per-station fixture first exposed a primary Overpass 504, raw HTML error text and a stale report. After bounded fallback/error/report fixes, a cold 20-trip run completed within the first five-second observation; the next batch took about 325 ms with metro path and 40/40 walking legs reused. Forty trips produced 65 base SVG paths (including station/point layers); selection added three paths. These service/UI observations are not CPU benchmark guarantees.
