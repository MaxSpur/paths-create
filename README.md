# Origin-Destination Creator

Origin-Destination Creator is a browser-only tool for building synthetic transit-like GPX tracks for testing, demos, and map visualizations.

Live app:
[https://www.maximspur.com/paths-create](https://www.maximspur.com/paths-create)

It lets you define origin and destination stations, build walking-access point pools around them, and generate complete trips made of:

1. a walking approach to the origin station,
2. a rail segment between the two stations based on OpenStreetMap data,
3. a walking exit from the destination station.

Individual points can also be switched to direct driving mode. Any generated pair containing a driving-mode point uses an ORS driving route directly between the paired points instead of the walking + rail + walking pipeline.

The generated trips are exported as GPX files inside a ZIP archive, with elevation included when available from openrouteservice.

## What You Can Do With It

- Select a collection of stations on a Leaflet map.
- Search for a location and choose from ranked candidate results before creating or finding stations.
- Assign each station a walking-access radius from 5 m to 5 km.
- Add walking points manually by clicking on the map, or generate random points inside a station radius.
- Toggle individual points between metro mode and direct driving mode.
- Set origin and destination stations for a generation run.
- Generate multiple trips while rotating through available point pairs to reduce repetition.
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
   If either point in a generated origin/destination pair is set to `D`, that trip is generated as a direct driving route. Otherwise, it uses the metro pipeline.
8. Generate trips in **Generate Trips**.
   - set `Trip count`,
   - optionally set `Seed` if you want reproducible results,
   - click `Generate`.
   The progress box shows the current phase and ends with a short generation report.
9. Review and export.
   - generated routes are drawn on the map as a preview,
   - `Clear preview` removes the current preview without deleting your stations or points,
   - `Download GPX ZIP` becomes useful after a successful generation run and downloads one GPX file per generated trip.

### Important Editing Rules

- Clicking inside a station radius activates that station.
- Setting a station as active from the sidebar refocuses the map to show that station and its full radius.
- In `Map click: add point` mode, clicks inside the active station radius add a point or move the selected point.
- Clicking outside the active station radius deselects the selected point, or activates another station if its radius was hit.
- `Idle` mode is the safe neutral mode when you want to inspect the map without adding or moving things.

## Quick Start

### Prerequisites

- Node.js 20+ is recommended.
- npm is required.

### Install and Run

```bash
npm install
npm run dev
```

Then open the local URL shown by Vite in your browser.

## Getting an openrouteservice API Key

This app uses the public openrouteservice API for walking directions and elevation. You need your own API key.

### Step-by-step

1. Go to the official openrouteservice login page:
   [https://openrouteservice.org/log-in/](https://openrouteservice.org/log-in/)
2. Sign in with GitHub.
   openrouteservice’s current login page explicitly says: “Log in to obtain an API key and access the developers dashboard,” and the official sign-in button is “Sign in with GitHub.”
3. Open the ORS dashboard:
   [https://openrouteservice.org/dev/](https://openrouteservice.org/dev/)
4. Create or reveal your API key in the dashboard.
5. Copy the key.
6. Paste it into the app’s `ORS API Key` field in the Settings section.

### If login or dashboard access is flaky

The official ORS FAQ notes that session sharing between `account.heigit.org` and `openrouteservice.org` may fail on some browser setups, especially with stricter privacy settings.

If the dashboard does not keep you signed in:

- allow cookies for `openrouteservice.org`,
- disable enhanced tracking protection for that site,
- allow third-party cookies for the site,
- try a different browser if needed.

Official FAQ:
[https://openrouteservice.org/faq/](https://openrouteservice.org/faq/)

### Quotas and limits

According to the ORS FAQ, quota resets every 24 hours. If you exceed the quota, the API will reject further requests until the quota resets or you move to a higher plan.

## What The App Produces

Each generated trip is exported as GPX and contains:

- the walk-in route geometry,
- the rail route geometry between the chosen stations,
- the walk-out route geometry,
- or, for driving-mode pairs, one direct driving route geometry,
- elevation in GPX track points when ORS provides it.

The download is a ZIP archive containing one GPX file per generated trip.

## How It Works

- Station and point data are managed entirely in the browser.
- Nearby station candidates and rail geometries come from Overpass / OpenStreetMap.
- Walking legs and elevation come from openrouteservice.
- Direct driving routes and driving alternatives come from openrouteservice.
- The rail leg is computed from OSM rail graph data and then elevation-draped through ORS.
- State is persisted locally in the browser via `localStorage`.

## Privacy And Local Data

- This app has no backend.
- Your ORS key is stored locally in your browser because the app runs entirely client-side.
- Station definitions, point pools, and map UI state are also stored locally in your browser.

## Development

### Test

```bash
npm run test:run
```

### Build

```bash
npm run build
```

### Deploy

GitHub Pages deployment is configured in:

- `.github/workflows/deploy.yml`

It builds the app and deploys `dist/` using GitHub Actions.

## Current Limits

- The app depends on external ORS and Overpass availability, quotas, and rate limits.
- The rail middle leg is geometry-based, not timetable-based.
- Station discovery from OSM is heuristic and may include results you want to curate manually.

## License

This project is released under the MIT License.
See [LICENSE](/Users/MadMax/Developer/Websites/Origin-Destination-Creator/LICENSE).

## Sources

- ORS login: [https://openrouteservice.org/log-in/](https://openrouteservice.org/log-in/)
- ORS dashboard: [https://openrouteservice.org/dev/](https://openrouteservice.org/dev/)
- ORS API landing page: [https://api.openrouteservice.org/](https://api.openrouteservice.org/)
- ORS FAQ: [https://openrouteservice.org/faq/](https://openrouteservice.org/faq/)
