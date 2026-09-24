# Origin-Destination Creator

Create synthetic origin-to-destination paths from a browser-based map, using manual point pools or NetMob survey records. Create reusable places and areas anywhere, combine walking with public transit, or generate direct driving/cycling routes.

**[Open the live app](https://www.maximspur.com/paths-create/)**

The interface and synthetic transit router run in the browser. Route generation uses either your own [openrouteservice API key](https://openrouteservice.org/dev/) or the optional local ORS companion. There is no account system.

## Highlights

- Search for any location and create a single-point place or circular area.
- Add points manually or generate a pool inside an area; areas may overlap. Turn off **Look up point addresses** for immediate coordinate labels and no reverse-geocoding wait.
- Search saved places by name and edit one at a time without changing From/To.
- Click each point’s mode button to cycle through T (transit, including bus), D (driving), C (cycling), and C+T (cycling + transit).
- Follow metro, RER, Transilien, tram and bus lines with walking interchanges in Île-de-France.
- Generate seeded, non-repeating batches of origin/destination pairs.
- Browse generation batches with compact, color-coded trip rows and one selected-trip detail view.
- Export GeoParquet by default, or enriched GPX ZIP, for the open batch or all batches.
- For larger local NetMob jobs, start `npm run netmob:serve` and use **NetMob → Local runs** to control the [resumable runner](NETMOB_RUNS.md), writing Parquet parts directly to a visible folder with an output-size cap and optional light geometry variation. Full-dataset endurance testing is still pending.
- Keep place data and settings in the current browser profile.

## Create A Trip Set

1. Open the [live app](https://www.maximspur.com/paths-create/) and choose Hosted ORS with your API key. For Local ORS, follow the local setup below and use the locally served app.
2. Search or navigate the map, then use **Add area** or **Add single point** and click a location.
3. Select an area in **Saved places**, name it, set its sampling radius, then **Add points on map** or **Generate points**. Single-point places are ready immediately.
4. Choose **From** and **To** independently of the place being edited. Use ⇄ to swap them.
5. Set modes on the points, then choose trip count and optional seed. Transit offers a maximum access walk and zero to three changes; C+T also offers a cycling access limit. These limits are separate from the sampling radius.
6. Select **Generate**. The router chooses boarding/alighting stops for each actual point pair, including walking access and interchanges.
7. Open a batch in **Generated Trips**, select a trip for details, then choose an export format/scope and select **Export**. When endpoints differ, D takes precedence, followed by C, C+T, then T. C+T always cycles at the origin and walks at the destination.

Each completed generation run adds a numbered batch of unused point pairs instead of replacing successful trips. The completion report shows failures and any route work reused from the current session.

### Map Editing

- Selecting a saved place opens its editor and focuses the map. From/To change only through their selectors or explicit assignment buttons.
- **Add points on map** always adds a point inside the selected area. **Move selected point** moves an existing point on the next valid click.
- **Move area & points** translates the whole pool; **Move place** repositions a single-point place. **Cancel placement** returns to selection.
- Shrinking a sampling radius keeps existing points. Overlapping areas retain independent pools.
- `Delete` or `Backspace` removes a selected area point. A single-point place is removed with **Delete place**.
- Click a trajectory to select its trip and reveal its list row without moving the map. Click a list row to focus its route, or again to deselect. Shared stretches select the first matching trip unless the selected trip is on top.

## NetMob Parquet pilot

Choose **NetMob** beside **Manual**, then open the supplied EMG and/or OD/time-cube Parquet files. Files are read locally; the cube can be explored but cannot generate routes because its area codes have no geographic crosswalk or transport modes.

1. **Explore** schema, weighted totals and paginated rows. Filter EMG by origin/destination, date/time, duration, mode sequence, purpose or eligibility; inspect a row for original values and exclusion reasons.
2. **Prepare pairs** for the selected row or a filtered batch. Reproducible points are sampled inside the referenced areas, including trips within one area. Change the seed or realization for another sample.
3. **Generate prepared** to try plausible street/transit routes against recorded modes and duration. Candidate endpoints are ranked by simulated movement duration by default; **Fit duration using** also offers the original ORS/timetable estimates. Defaults are 12 route trials and 100 records; the pilot caps these at 64 trials and 1,000 records. The provider and access limits come from Manual's settings. Cancel preserves completed results; **Retry unfinished** uses the original batch's records and realization.
4. **Review / export** modeled duration, signed error, fit quality, ordered legs and assumptions. Export all valid routes or acceptable fits only as GeoParquet or GPX ZIP; **Save report** retains failures and exclusions.

One generated trip represents one source row; weights are retained without expanding the population. A fit is acceptable within the greater of 3 minutes or 20% of recorded duration, both adjustable. The closest valid poor fit remains available. Missing durations are unassessed. Endpoints are geographical samples, not inferred homes or workplaces. Unknown modes, scooter/vehicle proxies and unverified parking are labeled.

Transit uses recent timetable-derived estimates, including boarding waits and walking connections. These are modeled times, not verified historical services. The damaged source arrival-time field remains raw metadata. Exports preserve source identity and trip/leg timing but do not create per-point timestamps.

**Inspect** shows the row’s full origin/destination boundaries. Mode/sequence and purpose dropdowns come from the file and follow other applied filters. Date fields include available bounds and a calendar heatmap; duration limits reflect the data. Empty combinations retain the previous filters.

To process more matches, set **Batch rows** (up to 1,000) and click **Apply settings**. **Prepare filtered batch** selects the displayed source range; after generation, **Prepare next source batch** advances to the next range. For 1,453 matches at 100 rows per batch, there are 15 ranges (the last has 53 rows). **Previous/Next map page** only change the preview. Completed rows cannot be generated twice with the same seed and realization while their results remain in the session; use **Retry unfinished** for failures or cancelled work.

**Trials** is the number of route attempts per row, including alternate endpoint locations and mode proxies. Each attempt may make several routing requests. **Realization** selects another reproducible sample for that row; it does not multiply the number of trips. **Show endpoint proposals** previews the sampled locations. Generation shows processed/total progress plus its active trial; live location drawing can be disabled and is limited to four updates per second.

The open batch appears in the map overview. Click a route or endpoint to focus it and open its details; selection never changes its checkbox. Check a route or batch to **keep it visible** while focusing elsewhere. These toggles start off and can combine multiple batches. Click the map background to clear focus; dragging keeps it. Click an area in the overview to highlight routes touching it. **Map appearance**, at the bottom right of the map, collapses into a small bar. It controls unfocused visibility (hidden by default), points, paths, outlines, and basemap saturation/brightness. Double-click brightness to reset it to 100%. Its collapsible **Colors** section lets you edit transport-method colors, individual transit-line colors, and origin/destination outlines and points. **Default colors** restores published IDFM/GTFS line colors and the app’s street-mode defaults; opacity settings stay unchanged. Display choices do not affect export scope. There is no 100-route display cap; large selections may slow map interaction. Batch labels summarize filters and source ranges; route labels show a short number and recorded mode sequence.

Route details compare the source and generated mode sequences. Original non-geometric row fields remain in both export formats, including principal/ordered modes, dates, purpose and weights. Source polygon/centroid payloads are not duplicated; generated geometry and boundary provenance are exported separately.

Select a generated NetMob route and open **Movement & GNSS pilot** to simulate acceleration, stops and seeded location noise. The initial settings reproduce the selected route’s fitting duration. Adjust sampling, additional assumed road delays, station dwell and noise parameters; compare simulated, original modeled and recorded durations. The red preview and separate observation Parquet export preserve the clean route. The duration model runs on every candidate without creating dense observations. Observation previews are limited to one selected route and 50,000 points; it creates no files automatically. [Model assumptions and measured results](MOVEMENT_SIMULATION.md).

Switching modes preserves Manual places, selections, settings and results. Imported files, prepared pairs and NetMob results are **session-only: export before reloading or closing**. **Close dataset** releases its import worker while retaining generated batches. Desktop memory is recommended: the measured 100-record mixed-mode run peaked near 3.1 GiB in the Node harness, excluding the local ORS server. Start small. For durable jobs, start `npm run netmob:serve` alongside the app, then use **Local runs**: create a job from applied filters, start a bounded stage, pause/resume and inspect saved routes. Outputs go to `local/netmob-runs/<name>/`; the browser can close while the controller keeps running. These local jobs persist on disk; the browser pilot remains session-only. The full-dataset endurance gate is still pending. [Pilot behavior and measured limits](NETMOB.md) and [supporting-data sources](public/data/netmob-data.LICENSE.md) provide details.

## Offline processing and online services

When the app is served locally and **Local ORS** is selected, street routing uses the local server; transit routing uses the bundled IDFM network; generation and GPX/Parquet export run locally. Disable **Look up point addresses** to avoid reverse-geocoding requests.

This is not a completely offline interface: the basemap fetches OpenStreetMap tiles, location search uses Nominatim, and **Find stations near map center** uses Overpass. These services remain online even with Local ORS selected. Hosted ORS also uses its public API when selected. A fully offline interface would need a local/disabled basemap and disabled or locally replaced search services; there is currently no master offline switch.

## Browse and export batches

Open one batch at a time. Trip pages contain up to 50 compact rows; use the arrows or page-number field to navigate. Mode badges and transit-line colors identify the itinerary; selecting a row shows its full details and focuses its route. Keyboard users can focus a row and press Enter or Space. Clicking a route reveals and highlights its row, including switching pages when necessary.

The map previews the open page plus the selected trip, so opening a large batch does not draw every route. **Export** includes all trips in the chosen scope, regardless of pagination. Choose **Open batch** or **All batches**, and **GeoParquet** or **GPX ZIP**. You can cancel an export and retry.

GeoParquet stores exact path coordinates and transport legs with batch/trip IDs and metadata. Exports are divided into parts of at most 1,000 trips. One Parquet part downloads directly; multiple parts are packaged in a ZIP with a manifest. GPX parts are compressed ZIPs; multi-part GPX downloads contain those ZIPs and a manifest. Large exports still need memory for the final download archive.

Delete individual trips, whole batches, or all trips. Generated batches are kept only for the current page session: **export before reloading or closing the page**. Saved places/settings remain in browser storage. Details of the Parquet schema and measured comparisons are in [PARQUET_EXPORT.md](PARQUET_EXPORT.md).

## GPX Output

Transit trips include separate tracks for the access walk, each line ridden, walking interchanges and the exit walk. For example, points near Pantin and Noisy–Champs can use RER E, change at Val de Fontenay, then take RER A. Different points in an area can use different stations. The map shows line colors and the trip list shows changes. Driving and Cycling each contain one street track. **Cycling + transit** routes the bike to an RER station, leaves it there, then uses transit and a destination walk. Its separate cycling limit defaults to 5 km. Bike parking is assumed and explicitly unverified in the interface and GPX; bikes are not modeled aboard transit or at the destination.

Transit geometry comes from a dated Île-de-France Mobilités snapshot loaded on demand (36.1 MB JSON, about 5.8 MB with gzip compression). Short station connectors are explicitly approximate; longer outdoor interchanges use ORS walking routes. Transit tracks remain 2D; ORS supplies elevation for street routes when available.

Files use standard GPX 1.1 plus an `odc` namespace describing transport mode, segment role, place and point identifiers, actual boarding/alighting stops, labels, and structured addresses. The complete format is documented in [GPX_EXPORT.md](GPX_EXPORT.md).

## Privacy And Saved Data

- The ORS key, places, points, and settings are stored in this browser origin's `localStorage`.
- The key is sent directly from the browser to openrouteservice when the app requests directions or elevation. Do not use the app in a shared browser profile if the key must remain private from other local users.
- Coordinates are sent to the external services needed for search, rail data, routing, and map tiles. See [SOURCES.md](SOURCES.md) for the service inventory.
- Address lookup defaults on. Turning it off cancels pending lookups and keeps existing resolved labels; new/moved points use coordinates. Turning it back on affects future edits without backfilling the whole library. Explicit location search stays available.
- Generated trips and the route-reuse cache last only for the current page session. Reloading clears them but keeps saved places and settings.
- Existing station circles migrate automatically to areas with names, radii, point IDs/addresses/modes and From/To selections preserved. Existing T/D modes are retained. Old global mode selections are converted once into point modes when the saved state is upgraded.
- **Reset all saved data** clears the app's persisted local state. Browser data is tied to the exact host and port, so a different origin has a separate state.

## Service Limits

- ORS, Overpass, Nominatim, and map-tile availability and usage limits are outside the app's control.
- Manual Île-de-France transit follows published service patterns and permitted transfers, with at most three changes and a preference for fewer changes. It models no schedules, durations or real-time availability; night bus patterns can therefore appear alongside daytime services.
- Automatic transit routing currently covers Île-de-France. Outside coverage, transit reports a clear failure; driving and cycling remain available.
- Candidate stops must have street access within the selected walking/cycling limits. Search is bounded, and failures may require another point or a different walking limit. There is no silent driving substitution.
- Provider-traced transit shapes and approximate station connectors are synthetic geometry, not exact underground corridors or accessibility guidance.
- Nearby-station discovery is heuristic, so its results may need manual curation.

## Run Locally

Use the Node version pinned in `.node-version` and npm 11.12.1 or newer.

```bash
npm ci
npm run dev
```

Open [http://127.0.0.1:5198/](http://127.0.0.1:5198/). The fixed port prevents this origin's saved data from appearing to disappear because Vite silently chose another port.

### Local ORS

Install Java 21 ([Temurin instructions](https://adoptium.net/installation)), then run these commands from the project directory after `npm ci` (macOS/Linux):

```bash
npm run ors:install
npm run ors:start
npm run ors:status
```

`install` downloads and verifies the pinned server and IDF map (~425 MB); the measured installation with graphs uses ~1.18 GiB. `start` runs ORS in the background; wait for status `ready`, then choose **Service settings → Routing service → Local ORS**. No API key is needed. The first run builds graphs; later starts load them. This setup returns 2D street geometry. Map tiles and location search still require internet. Stop it with `npm run ors:stop`. Complete setup, storage/memory requirements and troubleshooting are in [OFFLINE_ROUTING.md](OFFLINE_ROUTING.md).

## Project Documentation

- [NETMOB.md](NETMOB.md) — NetMob pilot model, source handling, limits and measurements.
- [ARCHITECTURE.md](ARCHITECTURE.md) — runtime structure, behavior, and deployment boundaries.
- [PERFORMANCE.md](PERFORMANCE.md) — benchmark method, browser fixture, and historical measurements.
- [GPX_EXPORT.md](GPX_EXPORT.md) — exported-file contract.
- [SOURCES.md](SOURCES.md) — external service and infrastructure references.
- [TODO.md](TODO.md) — active engineering backlog.
- [OFFLINE_ROUTING.md](OFFLINE_ROUTING.md) — local ORS sizing, feasibility and the remaining work for thousands of independent routes.

## License

Application code: [MIT](LICENSE). The bundled transit dataset has separate [Licence Mobilité and ODbL notices](public/data/idfm-transit.LICENSE.md); NetMob supporting assets have [their own source notice](public/data/netmob-data.LICENSE.md).
