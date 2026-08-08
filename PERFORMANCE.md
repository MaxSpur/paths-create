# Performance

This is the current benchmark contract and one reference comparison, not a chronological log. Refresh the table when a later change intentionally moves a budget or hot path.

## Commands And Fixture

```bash
npm run benchmark
npm run check
```

Benchmarks are offline and deterministic. The UI smoke fixture uses an origin area around Vincennes (`48.847, 2.439`) and a destination near Géodata Paris in Champs-sur-Marne (`48.8411, 2.5874`). Automated tests mock public services; the in-app browser is used for live search/layout observation.

Report repeated medians and p95 where practical. Do not mix ORS, Overpass, Nominatim, or tile-server latency into CPU/DOM results.

## Reference Comparison — 2026-08-08

Environment: macOS arm64, Node 26.3.0, npm 11.16.0. The dependency baseline used Vitest 2.1.9/Vite 5.4.21; the optimized run uses Vitest 4.1.10/Vite 8.2.1.

| Scenario | Before | After | Result |
| --- | ---: | ---: | ---: |
| 40k-node rail graph, snap two stations | 4.652 ms mean | 0.0446 ms mean | 99.0% lower |
| 40k-node graph, path across one connected row | 3.094 ms mean | 0.0250 ms mean | 99.2% lower |
| 90k-node line, worst-case shortest path | 659 ms median | 24.86 ms median | 96.2% lower |
| 250-point/250-trip generation progress | 86.67 ms full render | 1.72 ms targeted patch | 50.4× faster |
| 20×20 metro preview, no selected trip | 1,200 polylines | 41 unique polylines | 96.6% fewer |
| Walking request after ORS 401 | 4 requests | 1 request | 75% fewer |
| Driving-alternatives request after ORS 401 | 8 requests | 1 request | 87.5% fewer |
| Initial JavaScript | 93.73 kB gzip | 64.23 kB gzip | 31.5% lower |
| Test suite | 40 tests, ~2.83 s | 49 tests, ~1.48 s | more coverage, ~48% shorter |

The initial JavaScript reduction comes from loading JSZip only on download. The build also enforces an 80,000-byte gzip budget across initial JavaScript and CSS; the reference build is 70.6 KiB.

## Performance Boundaries

- `scripts/benchmarks/railGraph.bench.ts` covers snapping and shortest-path behavior on a 40k-node fixture.
- `scripts/benchmarks/panel.bench.ts` compares a full panel rebuild with the targeted progress patch.
- `scripts/check-bundle-size.mjs` reads the production HTML entry graph and fails when initial JavaScript plus CSS exceeds budget.
- `src/ui/previewSegments.ts` keeps base route geometry unique by shared-array identity; selection adds only the highlighted trip segments.
- Search uses a single Nominatim request at a time. Interactive searches are prioritized over queued reverse lookups and recent identical searches are cached, but live response time remains external.

## Remaining Bottlenecks

- Repeated generation batches can still repeat Overpass/rail elevation setup and overlapping walking legs. A bounded, coordinate-keyed session route cache is the next high-impact network optimization.
- Queued reverse lookups are not yet canceled after a point is moved again or deleted.
- The sidebar still uses a full rebuild for structural data changes; the targeted progress and clock paths cover the known high-frequency cases.
