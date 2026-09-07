# GPX Export

The app exports GPX 1.1 files with standard GPX geometry plus project-specific metadata in the `odc` XML namespace.

Namespace:

```xml
xmlns:odc="https://www.maximspur.com/origin-destination-creator/gpx/1"
```

## Track Structure

Each exported file contains one trip.

Metro trips contain three GPX tracks when all legs are present:

1. `<trk><type>walking</type>` with `odc:segment role="walk-in"`.
2. `<trk><type>metro</type>` with `odc:segment role="metro"`.
3. `<trk><type>walking</type>` with `odc:segment role="walk-out"`.

Driving trips contain one GPX track:

1. `<trk><type>driving</type>` with `odc:segment role="driving"`.

Each GPX track contains one `<trkseg>`. The full segment metadata is attached to the track in `<extensions><odc:segment ...>`. The `<trkseg>` also has `<extensions><odc:segmentRef ... />` so segment-level parsers can identify the transport leg without reading the parent track extension.

## Trip Metadata

The GPX `<metadata>` block contains:

- standard `<name>`, `<desc>`, and `<time>`,
- `<extensions><odc:trip id="..." routeMode="metro|driving" schemaVersion="1" segmentCount="...">`, with optional `pairKey`,
- one origin and one destination `<odc:station>`,
- one origin and one destination `<odc:point>`.

Stations carry `role`, `id`, `name`, `lat`, `lon`, `radiusM`. Points carry `role`, `id`, `tripMode`, `lat`, `lon`, `addressStatus`, with optional `<odc:label>` and structured `<odc:address>`.

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
- `role`: `walk-in`, `metro`, `walk-out`, or `driving`,
- `mode`: `walking`, `metro`, or `driving`,
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
- `src/test/gpxWriter.test.ts` covers parseable metro and driving output, structured addresses, and 2D coordinates.
- Run `npm run test:run -- src/test/gpxWriter.test.ts` for a focused contract check, and `npm run check` before release.
- Coordinate counts and `distanceM` are computed once per segment and reused in both the track and segment-reference metadata; the duplicated values must stay identical.
