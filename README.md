# Origin-Destination Creator

Create synthetic origin-to-destination GPX trips from a browser-based map. Create reusable places and areas anywhere, combine walking with public transit, or generate direct driving routes.

**[Open the live app](https://www.maximspur.com/paths-create/)**

The app runs entirely in the browser. Route generation requires your own [openrouteservice API key](https://openrouteservice.org/dev/); there is no project backend or account system.

## Highlights

- Search for any location and create a single-point place or circular area.
- Add points manually or generate a pool inside an area; areas may overlap.
- Search saved places by name and edit one at a time without changing From/To.
- Choose Transit, Driving, or Mixed using each point’s T/D setting.
- Follow metro, RER, Transilien and tram lines with walking interchanges in Île-de-France.
- Generate seeded, non-repeating batches of origin/destination pairs.
- Review and highlight generated routes directly on the map.
- Export one enriched GPX file per trip in a single ZIP archive.
- Keep place data and settings in the current browser profile.

## Create A Trip Set

1. Open the [live app](https://www.maximspur.com/paths-create/) and enter your ORS key under **Service settings**.
2. Search or navigate the map, then use **Add area** or **Add single point** and click a location.
3. Select an area in **Saved places**, name it, set its sampling radius, then **Add points on map** or **Generate points**. Single-point places are ready immediately.
4. Choose **From** and **To** independently of the place being edited. Use ⇄ to swap them.
5. Choose **Travel mode**, trip count and optional seed. Transit offers a maximum access walk at each end and zero to three changes. The walking limit is separate from the area's sampling radius.
6. Select **Generate**. The router chooses boarding/alighting stops for each actual point pair, including walking access and interchanges.
7. Inspect **Generated Trips** and select **Download GPX ZIP**. Mixed mode uses driving if either point is marked D; Transit and Driving override those point settings.

Later generation runs append unused point pairs instead of replacing successful trips. The completion report shows failures and any route work reused from the current session.

### Map Editing

- Selecting a saved place opens its editor and focuses the map. From/To change only through their selectors or explicit assignment buttons.
- **Add points on map** always adds a point inside the selected area. **Move selected point** moves an existing point on the next valid click.
- **Move area & points** translates the whole pool; **Move place** repositions a single-point place. **Cancel placement** returns to selection.
- Shrinking a sampling radius keeps existing points. Overlapping areas retain independent pools.
- `Delete` or `Backspace` removes a selected area point. A single-point place is removed with **Delete place**.
- Click a trajectory to select its trip and reveal its list row without moving the map. Click a list row to focus its route, or again to deselect. Shared stretches select the first matching trip unless the selected trip is on top.

## GPX Output

Transit trips include separate tracks for the access walk, each line ridden, walking interchanges and the exit walk. For example, points near Pantin and Noisy–Champs can use RER E, change at Val de Fontenay, then take RER A. Different points in an area can use different stations. The map shows line colors and the trip list shows changes. A driving trip contains one road track.

Transit geometry comes from a dated Île-de-France Mobilités snapshot loaded on demand. Short station connectors are explicitly approximate; longer outdoor interchanges use ORS walking routes. Transit tracks remain 2D; ORS supplies elevation for street routes when available.

Files use standard GPX 1.1 plus an `odc` namespace describing transport mode, segment role, place and point identifiers, actual boarding/alighting stops, labels, and structured addresses. The complete format is documented in [GPX_EXPORT.md](GPX_EXPORT.md).

## Privacy And Saved Data

- The ORS key, places, points, and settings are stored in this browser origin's `localStorage`.
- The key is sent directly from the browser to openrouteservice when the app requests directions or elevation. Do not use the app in a shared browser profile if the key must remain private from other local users.
- Coordinates are sent to the external services needed for search, rail data, routing, and map tiles. See [SOURCES.md](SOURCES.md) for the service inventory.
- Generated trips and the route-reuse cache last only for the current page session. Reloading clears them but keeps saved places and settings.
- Existing station circles migrate automatically to areas with names, radii, point IDs/addresses/modes and From/To selections preserved. Old T/D behavior becomes Mixed mode.
- **Reset all saved data** clears the app's persisted local state. Browser data is tied to the exact host and port, so a different origin has a separate state.

## Service Limits

- ORS, Overpass, Nominatim, and map-tile availability and usage limits are outside the app's control.
- Île-de-France transit follows published service patterns and permitted transfers, with at most three changes and a preference for fewer changes. It models no schedules, durations or real-time availability.
- Automatic transit routing currently covers Île-de-France. Outside coverage, transit reports a clear failure; driving remains available.
- Candidate stations must have a pedestrian route within the access-walk limit. Search is bounded, and failures may require another point or a different walking limit. There is no silent driving substitution.
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
