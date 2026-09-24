# Sources

References by topic. Service/runtime links were reviewed 2026-08-08 and GitHub Actions 2026-08-21; recheck official sources when changing those assumptions. Repository source records implemented policy, not current provider availability.

## Routing And Elevation

- [IDFM GTFS resource](https://transport.data.gouv.fr/resources/80921?locale=fr) and [official format documentation](https://eu.ftp.opendatasoft.com/stif/GTFS/opendata_gtfs.pdf) — reviewed 2026-09-07 for service patterns, shapes and transfers. Snapshot hash/coverage and distinct data licenses are in [the dataset notice](public/data/idfm-transit.LICENSE.md).
- [GTFS reference](https://gtfs.org/documentation/schedule/reference/) — directed stop sequences, pickup/dropoff rules, transfers and pathways. Transfer pairs do not supply corridor geometry.

- [openrouteservice API](https://api.openrouteservice.org/) — production API surface.
- [Directions API reference](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/) — profiles, request shapes, alternatives, and elevation options.
- [openrouteservice dashboard](https://openrouteservice.org/dev/) — user key management.
- [openrouteservice FAQ](https://openrouteservice.org/faq/) — quota and account guidance. Avoid copying volatile login UI details into the README.

- [Local ORS installation](OFFLINE_ROUTING.md) — installed/verified 2026-09-10: pinned native Java server, IDF extract checksums, measured graph size and independent-route benchmarks.
- [IDFM bike-parking inventory](https://prim.iledefrance-mobilites.fr/fr/jeux-de-donnees/parking-velos-ile-de-france-mobilites) — station-adjacent parking locations/types, metadata reviewed 2026-09-07. Not downloaded or integrated; cycling + transit currently marks parking unverified.

## NetMob pilot sources

Reviewed 2026-09-14. [Supporting-data notice](public/data/netmob-data.LICENSE.md) owns exact source URLs, pinned GTFS hash, licenses and rebuild commands. [NETMOB.md](NETMOB.md) owns dataset findings and timing assumptions.

- [Ville de Paris — Arrondissements](https://opendata.paris.fr/explore/dataset/arrondissements/): twenty exact arrondissement codes and boundaries, supplementing EMG's missing Paris polygons.
- [API Découpage administratif](https://geo.api.gouv.fr/decoupage-administratif/communes) / [Contours administratifs](https://www.data.gouv.fr/datasets/contours-administratifs): Guillerval 91294 and Mondreville 77297, retrieved with `geometry=contour`.
- [IDFM archive](https://transport.data.gouv.fr/datasets/reseau-urbain-et-interurbain-dile-de-france-mobilites): archive inspection did not establish historical coverage for almost all survey departures, and the earliest inspected 2023 feed lacked shapes. The pilot consequently uses a pinned recent feed with explicit modeled-time provenance.
- [GTFS schedule reference](https://gtfs.org/documentation/schedule/reference/): calendars/exceptions, local service times beyond 24:00, stop sequences and pickup restrictions inform offline preprocessing. Medians/headways are estimates, not a historical timetable router.

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

The optional NetMob controller binds loopback port 5199 and accepts only local development/preview app origins. It uses existing files and local ORS; it does not fetch new datasets, copy imports or route through hosted services. Browser map tiles retain the existing online behavior. See [NETMOB_RUNS.md](NETMOB_RUNS.md) for process, output and preview bounds.
