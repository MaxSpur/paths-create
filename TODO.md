# Active backlog

Confirm the relevant item against source before starting. Completed work belongs in git; recurring checks belong in AGENTS/LESSONS/PERFORMANCE.

- [ ] Support large batches with worker-based transit search, cancellation/resume, bounded previews and incremental storage/export; preserve individual endpoint routing.
- [ ] Match RER access to the official bike-parking inventory before offering verified parking; current cycling + transit is explicitly assumption-based.
- [ ] Add place-library JSON import/export with schema validation and a compatibility contract.
- [ ] Add polygon areas and optional station pinning; keep automatic per-point station choice as the default.
- [ ] Add an app-level lifecycle test spanning store notifications, scheduled renders and targeted progress patches; helper tests already exist.
- [ ] Add a deterministic large-preview benchmark that checks actual Leaflet layer counts, beyond pure segment counts.
- [ ] Extend transit coverage/refresh tooling and replace approximate internal station connectors where reliable pathway geometry is available.
- [ ] Consider optional scheduled journeys and durations later; keep today's synthetic mode independent of timetables.

- [ ] Add compact export options (lossless ZIP compression first), then optional speed-based observation sampling and seeded GNSS errors; retain clean route geometry and explicit model metadata. See GPX_EXPORT.md for measured sizes and design considerations.

- [ ] Integrate GeoParquet with bounded batch exports and structured canonical trips; generate GPX on demand. Prototype and measurements: PARQUET_EXPORT.md.
- [ ] Replace the flat trip list with a batch/trip hierarchy: compact child rows, mode/line colors and accessible icons/text, full details only for the selected trip, map-selection synchronization and virtualized lists/bounded previews.
