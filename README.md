# Origin-Destination Creator

Browser-only tool for generating synthetic transit-like GPX tracks for visualization testing.

## Features

- Leaflet map UI with station library management.
- Station-scoped footpath point pools (manual map clicks by default).
- Optional random point generation into a selected station pool.
- Origin/destination station selection per generation run.
- Synthetic trip composition:
  1. walk-in route to origin station,
  2. rail path between stations from OSM Overpass data,
  3. walk-out route from destination station.
- Anti-repeat pair generation (`round_robin_shuffle`).
- Persistent local state via `localStorage` key `odc.generator.state.v1`.
- GPX-only output bundled into ZIP download.

## Tech Stack

- Vite + TypeScript
- Leaflet
- OpenRouteService API (walking segments)
- Overpass API (stations + rail geometries)
- Vitest

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Start development server:

```bash
npm run dev
```

3. Open the app in your browser and paste your ORS API key in settings.

## Test and Build

```bash
npm run test:run
npm run build
```

## GitHub Pages Deployment

- Deployment workflow is at `.github/workflows/deploy.yml`.
- It runs on pushes to `main` or `master`, and on manual dispatch.
- It builds with `npm ci && npm run build` and deploys `dist/` via `actions/deploy-pages`.
- Keep GitHub Pages source set to `GitHub Actions` in repository settings.

## Notes

- This app has no backend; API calls are made directly from the browser.
- The ORS API key is intentionally persisted in localStorage per project requirements.
- Generated transit middle-leg is geometry-based, not schedule/timetable based.
