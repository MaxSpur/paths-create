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
