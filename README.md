# Origin-Destination Creator

Create synthetic origin-to-destination GPX trips from a browser-based map. Build reusable station access-point pools, combine walking with public transit, or switch individual points to direct driving routes.

**[Open the live app](https://www.maximspur.com/paths-create/)**

The app runs entirely in the browser. Route generation requires your own [openrouteservice API key](https://openrouteservice.org/dev/); there is no project backend or account system.

## Highlights

- Search for locations and add nearby rail stations from OpenStreetMap.
- Define a radius around each station and add access points manually or at random.
- Choose transit or direct-driving behavior for each access point.
- Follow metro, RER, Transilien and tram lines with walking interchanges in Île-de-France.
- Generate seeded, non-repeating batches of origin/destination pairs.
- Review and highlight generated routes directly on the map.
- Export one enriched GPX file per trip in a single ZIP archive.
- Keep station data and settings in the current browser profile.

## Create A Trip Set

1. Open the [live app](https://www.maximspur.com/paths-create/) and paste your ORS key into **Settings**.
2. Search for an area, or move the map and use **Find nearby stations at map center**.
3. Add at least two stations, then mark one as the origin and one as the destination.
4. Set each station's radius and make it active to add access points. Points can be placed on the map or created with **Generate random points**.
5. Leave a point in transit mode (`T`) for a walking/transit trip, or switch it to driving mode (`D`) for a direct road route. A pair uses driving if either endpoint is set to `D`.
6. Choose a trip count and optional seed, then select **Generate**.
7. Inspect routes under **Generated Trips** and select **Download GPX ZIP** when the set is ready.

Later generation runs append unused point pairs instead of replacing successful trips. The completion report shows failures and any route work reused from the current session.

### Map Editing

- **Idle** is the safe mode for inspecting the map.
- **Map click: add station** creates a station outside existing station radii.
- **Map click: add point** adds a point inside the active station's radius. Select an existing point first to move it with the next valid map click.
- Selecting another station or point updates what can be edited. `Delete` or `Backspace` removes the selected point.

## GPX Output

Transit trips include separate tracks for the access walk, each line ridden, walking interchanges and the exit walk. For example, Pantin → Noisy–Champs uses RER E, changes at Val de Fontenay, then takes RER A. The map shows line colors and the trip list shows changes. A driving trip contains one road track.

Transit geometry comes from a dated Île-de-France Mobilités snapshot loaded on demand. Short station connectors are explicitly approximate; longer outdoor interchanges use ORS walking routes. Transit tracks remain 2D; ORS supplies elevation for street routes when available.

Files use standard GPX 1.1 plus an `odc` namespace describing transport mode, segment role, station and point identifiers, labels, and structured addresses. The complete format is documented in [GPX_EXPORT.md](GPX_EXPORT.md).

## Privacy And Saved Data

- The ORS key, stations, access points, and settings are stored in this browser origin's `localStorage`.
- The key is sent directly from the browser to openrouteservice when the app requests directions or elevation. Do not use the app in a shared browser profile if the key must remain private from other local users.
- Coordinates are sent to the external services needed for search, rail data, routing, and map tiles. See [SOURCES.md](SOURCES.md) for the service inventory.
- Click a map trajectory to highlight its trip and reveal its Generated Trips row. Clicking a list row focuses the map; clicking it again deselects. Shared stretches select the first matching trip unless an already-selected trip is on top.
- Generated trips and the route-reuse cache last only for the current page session. Reloading clears them but keeps saved stations and settings.
- **Reset all saved data** clears the app's persisted local state. Browser data is tied to the exact host and port, so a different origin has a separate state.

## Service Limits

- ORS, Overpass, Nominatim, and map-tile availability and usage limits are outside the app's control.
- Île-de-France transit follows published service patterns and permitted transfers, with at most three changes and a preference for fewer changes. It models no schedules, durations or real-time availability.
- Outside the regional coverage, the previous OSM track-connectivity routing remains available, without line or transfer guarantees. Stations must be close to a supported boarding stop.
- Provider-traced rail shapes and approximate station connectors are synthetic geometry, not exact underground corridors or accessibility guidance.
- Nearby-station discovery is heuristic, so its results may need manual curation.

## Run Locally

Use the Node version pinned in `.node-version` and npm 11.12.1 or newer.

```bash
npm ci
npm run dev
```

Open [http://127.0.0.1:5198/](http://127.0.0.1:5198/). The fixed port prevents this origin's saved data from appearing to disappear because Vite silently chose another port.

## Project Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — runtime structure, behavior, and deployment boundaries.
- [PERFORMANCE.md](PERFORMANCE.md) — benchmark method, browser fixture, and historical measurements.
- [GPX_EXPORT.md](GPX_EXPORT.md) — exported-file contract.
- [SOURCES.md](SOURCES.md) — external service and infrastructure references.
- [TODO.md](TODO.md) — active engineering backlog.

## License

Application code: [MIT](LICENSE). The bundled transit dataset has separate [Licence Mobilité and ODbL notices](public/data/idfm-transit.LICENSE.md).
