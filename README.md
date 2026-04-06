# Origin-Destination Creator

Origin-Destination Creator is a browser-only tool for building synthetic transit-like GPX tracks for testing, demos, and map visualizations.

Live app:
[https://www.maximspur.com/paths-create](https://www.maximspur.com/paths-create)

It lets you define origin and destination stations, build walking-access point pools around them, and generate complete trips made of:

1. a walking approach to the origin station,
2. a rail segment between the two stations based on OpenStreetMap data,
3. a walking exit from the destination station.

The generated trips are exported as GPX files inside a ZIP archive, with elevation included when available from openrouteservice.

## What You Can Do With It

- Build a personal library of stations directly on a Leaflet map.
- Assign each station a walking-access radius from 5 m to 5 km.
- Add walking points manually by clicking on the map, or generate random points inside a station radius.
- Set origin and destination stations for a generation run.
- Generate multiple trips while rotating through available point pairs to reduce repetition.
- Export the result as GPX files for use in route visualization, testing, demos, or import into other tools.

## How To Use It

1. Start the app locally.
2. Paste an openrouteservice API key into the ORS API Key field.
3. Add stations by clicking the map or by importing nearby station candidates from Overpass.
4. For each station, set a radius that represents the walking-access area you want to use.
5. Add station points manually or generate them randomly inside that radius.
6. Pick an origin station and a destination station.
7. Choose how many trips you want to generate.
8. Generate the trips and download the resulting GPX ZIP.

### Map Editing Behavior

- Clicking inside a station radius activates that station.
- In `Map click: add point` mode, clicks inside the active station radius add a new point.
- If a station point is selected, clicking inside the active station radius moves that point.
- Clicking outside the active station radius deselects the selected point, or activates another station if its radius was hit.
- Setting a station as active from the sidebar refocuses the map to show that station and its full radius.

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
- elevation in GPX track points when ORS provides it.

The download is a ZIP archive containing one GPX file per generated trip.

## How It Works

- Station and point data are managed entirely in the browser.
- Nearby station candidates and rail geometries come from Overpass / OpenStreetMap.
- Walking legs and elevation come from openrouteservice.
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
