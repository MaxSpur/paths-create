# Active backlog

Confirm the relevant item against source before starting. Completed work belongs in git; recurring checks belong in AGENTS/LESSONS/PERFORMANCE.

- [ ] Cancel or coalesce obsolete queued reverse-geocode work after point moves/deletion; preserve stale-response guards, clock state and shared search priority/rate limits.
- [ ] Replace station-owned point pools with arbitrary named areas or single points; route each point pair through multiple candidate boarding/alighting stops, validate walking access, and migrate existing stations/radii/points without data loss. Keep station pinning optional and coverage limits explicit.
- [ ] Add station-library JSON import/export with schema validation and a compatibility contract.
- [ ] Improve OSM station discovery filters for easier curation.
- [ ] Add an app-level lifecycle test spanning store notifications, scheduled renders and targeted progress patches; helper tests already exist.
- [ ] Add a deterministic large-preview benchmark that checks actual Leaflet layer counts, beyond pure segment counts.
- [ ] Extend transit coverage/refresh tooling and replace approximate internal station connectors where reliable pathway geometry is available.
- [ ] Consider optional scheduled journeys and durations later; keep today's synthetic mode independent of timetables.
