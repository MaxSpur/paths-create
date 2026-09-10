# GPX Export

The app exports GPX 1.1 files with standard GPX geometry plus project-specific metadata in the `odc` XML namespace.

Namespace:

```xml
xmlns:odc="https://www.maximspur.com/origin-destination-creator/gpx/1"
```

## Track Structure

Places & Areas exports use trip `schemaVersion="3"` for both transit and driving. Origin/destination collections are `<odc:place kind="area|point">` with ID, name and center coordinates; `radiusM` exists only for areas. These are collection metadata, not boarding stations. Actual sampled endpoints remain `<odc:point>`; real transit stops remain segment `kind="stop"` references.

Transit track structure follows schema 2: access walk, ordered transit/transfer legs, then exit walk. Transit track types are `metro`, `rer`, `train`, `tram` or `bus`; transfer tracks use `walking`. Segment roles distinguish `transit` and `transfer`. Each leg has stop references; transit legs also carry line ID/name. `geometrySource` distinguishes `gtfs`, `ors` and approximate `station-connector` geometry. These fields are repeated consistently on `odc:segment` and `odc:segmentRef`.

Schema 2 trip metadata includes `networkVersion`, `transferCount` and data attribution/license URLs. The legacy trip `routeMode="metro"` and namespace remain compatible with saved point modes; readers must use track modes for actual transport type. No departure times or durations are synthesized. The standard metadata time is file creation time.

Legacy callers without the places flag retain schemas 1/2. Consumers must inspect `schemaVersion` and explicitly support schema 3 rather than treating a collection center as a station or assuming three tracks.

Cycling exports use schema 4 (same place contract as schema 3): direct cycling has `routeMode="cycling"` and one `role="cycling" mode="cycling"` track. Cycling + transit retains `routeMode="metro"`, sets `accessMode="cycling"`, `bikeHandling="leave-at-boarding-station"`, `bikeParking="unverified"`, and starts with `role="cycle-in" mode="cycling"`. Later transit/transfer tracks and the exit walk keep their own modes; no bike carriage or confirmed parking is asserted. Consumers must explicitly support these roles/modes. Points without requested address lookup use `addressStatus="skipped"` and coordinate labels.

Each exported file contains one trip.

Legacy OSM metro trips contain three GPX tracks when all legs are present:

1. `<trk><type>walking</type>` with `odc:segment role="walk-in"`.
2. `<trk><type>metro</type>` with `odc:segment role="metro"`.
3. `<trk><type>walking</type>` with `odc:segment role="walk-out"`.

Driving trips contain one GPX track:

1. `<trk><type>driving</type>` with `odc:segment role="driving"`.

Each GPX track contains one `<trkseg>`. The full segment metadata is attached to the track in `<extensions><odc:segment ...>`. The `<trkseg>` also has `<extensions><odc:segmentRef ... />` so segment-level parsers can identify the transport leg without reading the parent track extension.

## Trip Metadata

Legacy schema 1/2 metadata (schema 3 replaces `<odc:station>` with `<odc:place>`):

- standard `<name>`, `<desc>`, and `<time>`,
- `<extensions><odc:trip id="..." routeMode="metro|driving" schemaVersion="1" segmentCount="...">`, with optional `pairKey`,
- one origin and one destination `<odc:station>`,
- one origin and one destination `<odc:point>`.

Stations carry `role`, `id`, `name`, `lat`, `lon`, `radiusM`. Points carry `role`, `id`, `tripMode` (`metro`, `driving`, `cycling`, `cycling_transit`), `lat`, `lon`, `addressStatus`, with optional `<odc:label>` and structured `<odc:address>`.

Structured addresses preserve the Nominatim `display_name` and address fields when available:

```xml
<odc:address>
  <odc:displayName>...</odc:displayName>
  <odc:component key="road">...</odc:component>
  <odc:component key="house_number">...</odc:component>
  <odc:component key="city">...</odc:component>
</odc:address>
```

Existing saved points may only have a label, because structured address storage was added after the original address lookup implementation.

## Segment Metadata

Each `<odc:segment>` includes:

- `index`: 1-based leg index inside the trip,
- `role`: `walk-in`, `metro`, `walk-out`, `driving`, `transit`, `transfer`, `cycling`, or `cycle-in`,
- `mode`: `walking`, `driving`, `cycling`, `metro`, `rer`, `train`, `tram`, or `bus`,
- `pointCount`: number of GPX points in the segment,
- `distanceM`: approximate haversine segment length in meters,
- `<odc:from>` and `<odc:to>` endpoint references.

Example:

```xml
<trk>
  <name>Origin to Destination #1 - walk-in</name>
  <desc>Walking route from Origin Road 1, Berlin to Origin.</desc>
  <type>walking</type>
  <extensions>
    <odc:segment index="1" role="walk-in" mode="walking" pointCount="42" distanceM="515.20">
      <odc:from kind="point" role="origin" ref="o1" name="Origin Road 1, Berlin" />
      <odc:to kind="station" role="origin" ref="origin" name="Origin" />
    </odc:segment>
  </extensions>
  <trkseg>
    <trkpt lat="52.5000000" lon="13.4000000">
      <ele>41.1</ele>
    </trkpt>
    <extensions>
      <odc:segmentRef index="1" role="walk-in" mode="walking" pointCount="42" distanceM="515.20" />
    </extensions>
  </trkseg>
</trk>
```

## Implementation And Validation

- `src/lib/gpxWriter.ts` is the implementation source of truth.
- `src/test/automaticTransit.test.ts` checks cycling/parking metadata and preview modes; `src/test/gpxWriter.test.ts` covers parseable metro and driving output, structured addresses, and 2D coordinates.
- Run `npm run test:run -- src/test/gpxWriter.test.ts` for a focused contract check, and `npm run check` before release.
- Coordinate counts and `distanceM` are computed once per segment and reused in both the track and segment-reference metadata; the duplicated values must stay identical.

## Resolution and future observation sampling

Current GPX exports preserve irregular provider vertices, not regularly sampled GNSS observations. No per-point times, speed profiles or observation noise exist. Coordinates are formatted to seven decimal places (~1.1 cm latitude / 0.7 cm longitude in IDF); this is serialization precision, not positional accuracy. Bundled transit shapes are rounded to six decimals after 3 m RDP simplification, preserving inter-stop section endpoints. ORS street routes have no additional app-side simplification. ZIP currently uses JSZip's default STORE method, without compression.

Illustrative local ORS measurements on 2026-09-10, with the current writer, 2D coordinates and minimal trip metadata (decimal kB):

| Route | Length | Points | Median vertex gap | GPX | DEFLATE payload |
| --- | ---: | ---: | ---: | ---: | ---: |
| Walking near Pantin | 1.35 km | 79 | 7.0 m | 5.32 kB | 1.15 kB |
| Cycling toward Noisy–Champs | 17.73 km | 493 | 18.4 m | 25.65 kB | 4.32 kB |
| Driving toward Noisy–Champs | 20.99 km | 379 | 34.8 m | 20.06 kB | 3.51 kB |

Endpoints: all start at [2.402, 48.895]; walking ends at [2.414, 48.899], cycling/driving at [2.58, 48.843] (longitude, latitude). DEFLATE is a measured alternative, not current export behavior; ZIP headers add overhead. These are illustrative routes, not measurements of the user's saved trips or a population average. Additional addresses, elevations and transit legs increase size. At IDF coordinates each current 2D trackpoint contributes about 51 bytes including formatting, plus trip/leg metadata. Browser memory additionally holds coordinate arrays, previews and GPX strings; it is not equal to file size.

Keep compact route geometry and synthetic observations separate. A future observation stage can traverse each leg by accumulated distance and modeled speed, sampling at a configurable time interval in O(vertices + samples). This needs synthetic elapsed time, not real service schedules. Faster travel produces larger gaps at a fixed interval, but sampling may densify already sparse geometry. Preserve underlying bends and leg boundaries; a compact route export should instead use a spatial error tolerance. Stops, acceleration and road/rail context need explicit assumptions before claiming realistic speed profiles.

Future GNSS simulation should keep clean truth alongside observations and record a seed, interval and model parameters. Consider spatially/temporally correlated drift, multipath, independent noise, outliers and dropouts, especially underground. The user's reference slide gives Gaussian/exponential correlation components (sigma 0.5 m / range 100 m and sigma 5 m / range 20 m) plus white noise (sigma 1 m / range 0 m); these are example model parameters, not validated defaults for every mode/environment. Apply observation noise after sampling and keep it distinct from geometric simplification and decimal rounding. Scope remains exploratory; no export behavior changed.
