# Origin-Destination Creator

Origin-Destination Creator is a browser-only tool for building synthetic transit-like GPX tracks for testing, demos, and map visualizations.

Live app:
[https://www.maximspur.com/paths-create/](https://www.maximspur.com/paths-create/)

It lets you define origin and destination stations, build walking-access point pools around them, and generate complete trips made of:

1. a walking approach to the origin station,
2. a rail segment between the two stations based on OpenStreetMap data,
3. a walking exit from the destination station.

Individual points can also be switched to direct driving mode. Any generated pair containing a driving-mode point uses an ORS driving route directly between the paired points instead of the walking + rail + walking pipeline.

The generated trips are exported as GPX files inside a ZIP archive, with elevation included when available from openrouteservice. The GPX files include explicit transport-leg metadata in a custom `odc` XML namespace; see [GPX_EXPORT.md](GPX_EXPORT.md).

## What You Can Do With It

- Select a collection of stations on a Leaflet map.
- Search for a location and choose from ranked candidate results before creating or finding stations.
- Assign each station a walking-access radius from 5 m to 5 km.
- Add walking points manually by clicking on the map, or generate random points inside a station radius.
- Toggle individual points between metro mode and direct driving mode.
- Set origin and destination stations for a generation run.
- Generate multiple trips while rotating through available point pairs to reduce repetition.
- Keep generated trips in a list, select one to highlight it on the map, and delete individual trips or the whole list.
- Export the result as GPX files for use in route visualization, testing, demos, or import into other tools.

## How To Use It

Use the app in this order:

1. Open the app and move the map to the city or area you want to work in.
   Use the search field in the top-right of the map when you want to jump directly to a place. The app shows candidate results, biased toward the currently visible map area.
   The `Find nearby stations at map center` action uses the current map center, so it helps to pan/zoom roughly to the right area first.
2. In **Settings**, paste your openrouteservice key into `ORS API Key`.
   Leave the default `Overpass URL` alone unless you intentionally want to use a different Overpass instance.
3. Build your station library in **Stations**.
   You have two ways to do this:
   - click `Map click: add station`, then click the map outside any existing station radius,
   - or click `Find nearby stations at map center`, choose a candidate in the dropdown, and click `Add selected`.
4. For each station card:
   - rename the station if needed,
   - set the station radius with the slider,
   - use `Set active` when you want to edit that station’s point pool.
   The station radius matters: it controls both random point generation and where point add/move clicks are allowed.
5. Add walking-access points for the active station in **Active Station Points**.
   You can do this in two ways:
   - manual points: click `Map click: add point`, then click inside the active station radius,
   - random points: enter `Random count`, then click `Generate random points`.
   Random points always use the active station’s current radius.
6. Edit the active station’s points until the pool looks right.
   - click a point on the map or in the list to select it,
   - with `Map click: add point` mode active, click somewhere else inside the active station radius to move the selected point,
   - click outside the active station radius to deselect the point,
   - use the `M` / `D` button to choose whether that point uses the metro pipeline or direct driving when paired,
   - use `Delete` in the list, or `Delete` / `Backspace` on the keyboard, to remove the selected point.
   Point labels are reverse-geocoded automatically, so new or moved points may briefly show as resolving before their address appears.
7. Choose the trip endpoints.
   Use either the `Origin station` / `Destination station` dropdowns or the `Set origin` / `Set destination` buttons in each station card.
   For useful output, both the origin and destination stations should have at least one point; more points give the generator more combinations and reduce repetition.
   If either point in a generated origin/destination pair is set to `D`, that trip is generated as a direct driving route. Otherwise, it uses the metro pipeline. Metro points are orange on the map; driving points are purple.
8. Generate trips in **Generate Trips**.
   - set `Trip count`,
   - optionally set `Seed` if you want reproducible results,
   - click `Generate`.
   The progress box shows the current phase and ends with a short generation report.
   Later generation runs only request origin/destination point pairs that are not already in the generated-trip list, then append successful new trips to that list.
9. Review and export.
   - generated routes are drawn on the map as a preview,
   - select a row in **Generated Trips** to highlight and focus that route,
   - delete individual rows, or use `Delete all` to clear the generated-trip list without deleting stations or points,
   - `Download GPX ZIP` becomes useful after at least one successful generated trip and downloads one GPX file per trip in the list.

### Important Editing Rules

- Clicking inside a station radius activates that station.
- Setting a station as active from the sidebar refocuses the map to show that station and its full radius.
- In `Map click: add point` mode, clicks inside the active station radius add a point or move the selected point.
- Clicking outside the active station radius deselects the selected point, or activates another station if its radius was hit.
- `Idle` mode is the safe neutral mode when you want to inspect the map without adding or moving things.

## Quick Start

### Prerequisites

- Node.js 24 LTS. The current tested version is pinned in `.node-version`.
- npm 11.12.1 or newer.

### Install and Run

```bash
npm ci
npm run dev
```

Open [http://127.0.0.1:5198/](http://127.0.0.1:5198/). The fixed strict port preserves origin-scoped saved data; if it is occupied, Vite stops and reports the collision instead of silently choosing a different origin.

## Getting an openrouteservice API Key

This app uses openrouteservice for directions and elevation. Create or reveal a key in the [ORS dashboard](https://openrouteservice.org/dev/), then paste it into `ORS API Key` in Settings. The key stays in this browser origin's localStorage.

Account flows and quotas can change; use the [ORS FAQ](https://openrouteservice.org/faq/) and the project [source registry](SOURCES.md) rather than relying on copied login-screen text.

## What The App Produces

Each generated trip is exported as GPX and contains:

- one named GPX track per transport leg,
- explicit `<type>` values: `walking`, `metro`, or `driving`,
- `odc:*` metadata for route mode, segment role, station IDs, point IDs, point modes, labels, and structured address components when available,
- elevation in GPX track points when ORS provides it.

The download is a ZIP archive containing one GPX file per generated trip.

## How It Works

- Station and point data are managed entirely in the browser.
- Nearby station candidates and rail geometries come from Overpass / OpenStreetMap.
- Walking legs and elevation come from openrouteservice.
- Direct driving routes and driving alternatives come from openrouteservice.
- The rail leg is computed from OSM rail graph data and then elevation-draped through ORS.
- State is persisted locally in the browser via `localStorage`.
- Saved state belongs to the exact browser origin. Changing the host or port shows a separate state.
- Generated trip previews are session-local and are cleared by page reloads or `Delete all`.

## Privacy And Local Data

- This app has no backend.
- Your ORS key is stored locally in your browser because the app runs entirely client-side.
- Station definitions, point pools, and map UI state are also stored locally in your browser.

## Development

### Verify

```bash
npm run check
```

This runs the tests, production TypeScript/Vite build, and initial bundle-size budget.

### Benchmark

```bash
npm run benchmark
```

See [PERFORMANCE.md](PERFORMANCE.md) for the deterministic Vincennes-to-Géodata fixture and current reference results.

### Preview

```bash
npm run preview
```

Open [http://127.0.0.1:4198/](http://127.0.0.1:4198/).

### Deploy

Pull requests run `.github/workflows/check.yml`. Pushes to `master` run the same verification gate, build `dist/`, and deploy through `.github/workflows/deploy.yml`. Local work is not published until it is committed and pushed.

## Current Limits

- The app depends on external ORS and Overpass availability, quotas, and rate limits.
- The rail middle leg is geometry-based, not timetable-based.
- Station discovery from OSM is heuristic and may include results you want to curate manually.

## License

This project is released under the MIT License.
See [LICENSE](LICENSE).

## Sources

External service, runtime, and deployment references are maintained in [SOURCES.md](SOURCES.md).
