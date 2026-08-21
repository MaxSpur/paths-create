# Sources

Authoritative external assumptions, last reviewed 2026-08-08. Recheck them before changing service policy, runtime support, or deployment infrastructure.

## Routing And Elevation

- [openrouteservice API](https://api.openrouteservice.org/) — production API surface.
- [Directions API reference](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/) — profiles, request shapes, alternatives, and elevation options.
- [openrouteservice dashboard](https://openrouteservice.org/dev/) — user key management.
- [openrouteservice FAQ](https://openrouteservice.org/faq/) — quota and account guidance. Avoid copying volatile login UI details into the README.

## OpenStreetMap Data And Search

- [Overpass API overview and public instances](https://wiki.openstreetmap.org/wiki/Overpass_API) — query model, public-instance constraints, and the currently documented global backup endpoint (`overpass.private.coffee`). The app uses at most one sequential backup attempt for transient failures of its default endpoint.
- [Nominatim Search API](https://nominatim.org/release-docs/latest/api/Search/) — explicit forward-search parameters.
- [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) — rate limiting and public-service usage. The app keeps one serialized queue and does not use autocomplete.
- [OpenStreetMap copyright](https://www.openstreetmap.org/copyright) — map/data attribution.
- [Leaflet reference](https://leafletjs.com/reference.html) — map and layer behavior.

## Runtime, Build, And Deployment

- [Node.js 24 release archive](https://nodejs.org/en/download/archive/v24) — pinned LTS line and bundled npm version.
- [Vite server options](https://vite.dev/config/server-options.html) — fixed host, port, and `strictPort` behavior.
- [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) — configure, upload, deploy, and permission boundaries.
- [actions/checkout](https://github.com/actions/checkout), [actions/setup-node](https://github.com/actions/setup-node), [actions/configure-pages](https://github.com/actions/configure-pages), [actions/upload-pages-artifact](https://github.com/actions/upload-pages-artifact), and [actions/deploy-pages](https://github.com/actions/deploy-pages) — supported action majors and Node runtime compatibility, last checked 2026-08-21.

## Repository Contracts

- `.github/workflows/check.yml` — pull-request verification.
- `.github/workflows/deploy.yml` — `master` verification and Pages deployment.
- `README.md` — user-facing setup and workflow.
- `ARCHITECTURE.md` — runtime boundaries and behavior.
- `PERFORMANCE.md` — benchmark method and current measured comparison.
- `GPX_EXPORT.md` — exported XML contract.
