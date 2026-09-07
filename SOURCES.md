# Sources

References by topic. Service/runtime links were reviewed 2026-08-08 and GitHub Actions 2026-08-21; recheck official sources when changing those assumptions. Repository source records implemented policy, not current provider availability.

## Routing And Elevation

- [openrouteservice API](https://api.openrouteservice.org/) — production API surface.
- [Directions API reference](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/) — profiles, request shapes, alternatives, and elevation options.
- [openrouteservice dashboard](https://openrouteservice.org/dev/) — user key management.
- [openrouteservice FAQ](https://openrouteservice.org/faq/) — quota and account guidance. Avoid copying volatile login UI details into the README.

## OpenStreetMap Data And Search

- [Overpass API overview and public instances](https://wiki.openstreetmap.org/wiki/Overpass_API) — query model and public-instance constraints. The configured rail-query backup is `overpass.private.coffee`; recheck its suitability before changing fallback policy.
- [Nominatim Search API](https://nominatim.org/release-docs/latest/api/Search/) — explicit forward-search parameters.
- [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) — rate limiting and public-service usage. The app keeps one serialized queue and does not use autocomplete.
- [OpenStreetMap copyright](https://www.openstreetmap.org/copyright) — map/data attribution.
- [Leaflet reference](https://leafletjs.com/reference.html) — map and layer behavior.

## Runtime, Build, And Deployment

- [Node.js 24 release archive](https://nodejs.org/en/download/archive/v24) — pinned LTS line and bundled npm version.
- [Vite server options](https://vite.dev/config/server-options.html) — fixed host, port, and `strictPort` behavior.
- [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) — configure, upload, deploy, and permission boundaries.
- [actions/checkout](https://github.com/actions/checkout), [actions/setup-node](https://github.com/actions/setup-node), [actions/configure-pages](https://github.com/actions/configure-pages), [actions/upload-pages-artifact](https://github.com/actions/upload-pages-artifact), and [actions/deploy-pages](https://github.com/actions/deploy-pages) — supported action majors and Node runtime compatibility, last checked 2026-08-21.

## Agent guidance

Reviewed 2026-09-07:

- [OpenAI Astra guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra) — audit conflicting file instructions; calibrate autonomy, delegation, writing and verification to the task.
- [OpenAI AGENTS.md guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md) — global/project instruction discovery and precedence.

Project guidance keeps task-specific constraints and routes optional reads. General working preferences remain inherited; API migration parameters do not apply to this browser app.
