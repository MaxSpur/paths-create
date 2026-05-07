import { haversineDistanceM, toLatLon } from "./geo";
import type { LonLat, StructuredAddress, TripRouteMode, WalkPoint } from "./types";

const ODC_GPX_NAMESPACE = "https://www.maximspur.com/origin-destination-creator/gpx/1";

type SegmentRole = "walk-in" | "metro" | "walk-out" | "driving";
type SegmentMode = "walking" | "metro" | "driving";
type EndpointKind = "point" | "station";
type EndpointRole = "origin" | "destination";

interface SegmentEndpoint {
  kind: EndpointKind;
  role: EndpointRole;
  ref: string;
  name?: string;
}

interface TripSegment {
  role: SegmentRole;
  mode: SegmentMode;
  name: string;
  description: string;
  from: SegmentEndpoint;
  to: SegmentEndpoint;
  coords: LonLat[];
}

export interface GpxStationInput {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
}

export interface GpxPointInput {
  id: string;
  lat: number;
  lon: number;
  label?: string;
  address?: StructuredAddress;
  addressStatus?: WalkPoint["addressStatus"];
  tripMode?: WalkPoint["tripMode"];
}

export interface GpxTripInput {
  id: string;
  name: string;
  routeMode?: TripRouteMode;
  originStation: GpxStationInput;
  destinationStation: GpxStationInput;
  originPoint?: GpxPointInput;
  destinationPoint?: GpxPointInput;
  walkIn: LonLat[];
  metro: LonLat[];
  walkOut: LonLat[];
  driving?: LonLat[];
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatCoord(value: number): string {
  return value.toFixed(7);
}

function formatDistance(value: number): string {
  return value.toFixed(2);
}

function xmlAttrs(attrs: Record<string, string | number | undefined | null>): string {
  return Object.entries(attrs)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== null)
    .map(([key, value]) => ` ${key}="${escapeXml(String(value))}"`)
    .join("");
}

function stationName(station: GpxStationInput): string {
  return station.name.trim() || station.id;
}

function pointName(point: GpxPointInput | undefined): string {
  if (!point) {
    return "unknown point";
  }
  return point.label?.trim() || point.id;
}

function pointMode(point: GpxPointInput | undefined): "metro" | "driving" {
  return point?.tripMode === "driving" ? "driving" : "metro";
}

function resolvedRouteMode(input: GpxTripInput): TripRouteMode {
  if (input.routeMode) {
    return input.routeMode;
  }
  return input.driving && input.driving.length > 0 ? "driving" : "metro";
}

function trackPointToXml([lon, lat, elevation]: LonLat): string {
  const pointTag = `lat="${formatCoord(lat)}" lon="${formatCoord(lon)}"`;
  if (typeof elevation === "number" && Number.isFinite(elevation)) {
    return `<trkpt ${pointTag}>\n        <ele>${elevation}</ele>\n      </trkpt>`;
  }

  return `<trkpt ${pointTag} />`;
}

function segmentDistanceM(coords: LonLat[]): number {
  let distance = 0;
  for (let index = 1; index < coords.length; index += 1) {
    distance += haversineDistanceM(toLatLon(coords[index - 1]), toLatLon(coords[index]));
  }
  return distance;
}

function endpointToXml(endpoint: SegmentEndpoint, tagName: "odc:from" | "odc:to"): string {
  return `<${tagName}${xmlAttrs({
    kind: endpoint.kind,
    role: endpoint.role,
    ref: endpoint.ref,
    name: endpoint.name
  })} />`;
}

function segmentMetadataToXml(segment: TripSegment, index: number): string {
  return `<odc:segment${xmlAttrs({
    index,
    role: segment.role,
    mode: segment.mode,
    pointCount: segment.coords.length,
    distanceM: formatDistance(segmentDistanceM(segment.coords))
  })}>
        ${endpointToXml(segment.from, "odc:from")}
        ${endpointToXml(segment.to, "odc:to")}
      </odc:segment>`;
}

function segmentRefToXml(segment: TripSegment, index: number): string {
  return `<odc:segmentRef${xmlAttrs({
    index,
    role: segment.role,
    mode: segment.mode,
    pointCount: segment.coords.length,
    distanceM: formatDistance(segmentDistanceM(segment.coords))
  })} />`;
}

function segmentToXml(segment: TripSegment, index: number): string {
  const points = segment.coords.map((coord) => trackPointToXml(coord)).join("\n      ");
  return `<trkseg>
      ${points}
      <extensions>
        ${segmentRefToXml(segment, index)}
      </extensions>
    </trkseg>`;
}

function trackToXml(segment: TripSegment, index: number): string {
  return `<trk>
    <name>${escapeXml(segment.name)}</name>
    <desc>${escapeXml(segment.description)}</desc>
    <type>${escapeXml(segment.mode)}</type>
    <extensions>
      ${segmentMetadataToXml(segment, index)}
    </extensions>
    ${segmentToXml(segment, index)}
  </trk>`;
}

function stationToXml(role: EndpointRole, station: GpxStationInput): string {
  return `<odc:station${xmlAttrs({
    role,
    id: station.id,
    name: station.name,
    lat: formatCoord(station.lat),
    lon: formatCoord(station.lon),
    radiusM: station.radiusM
  })} />`;
}

function addressToXml(address: StructuredAddress | undefined): string {
  if (!address) {
    return "";
  }

  const displayName = address.displayName?.trim()
    ? `\n        <odc:displayName>${escapeXml(address.displayName.trim())}</odc:displayName>`
    : "";
  const components = Object.entries(address.components ?? {})
    .filter(([, value]) => value.trim().length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `\n        <odc:component${xmlAttrs({ key })}>${escapeXml(value.trim())}</odc:component>`)
    .join("");

  if (!displayName && !components) {
    return "";
  }

  return `\n      <odc:address>${displayName}${components}\n      </odc:address>`;
}

function pointToXml(role: EndpointRole, point: GpxPointInput | undefined): string {
  if (!point) {
    return `<odc:point${xmlAttrs({ role, missing: "true" })} />`;
  }

  const label = point.label?.trim()
    ? `\n      <odc:label>${escapeXml(point.label.trim())}</odc:label>`
    : "";
  const address = addressToXml(point.address);
  if (!label && !address) {
    return `<odc:point${xmlAttrs({
      role,
      id: point.id,
      tripMode: pointMode(point),
      lat: formatCoord(point.lat),
      lon: formatCoord(point.lon),
      addressStatus: point.addressStatus
    })} />`;
  }

  return `<odc:point${xmlAttrs({
    role,
    id: point.id,
    tripMode: pointMode(point),
    lat: formatCoord(point.lat),
    lon: formatCoord(point.lon),
    addressStatus: point.addressStatus
  })}>${label}${address}
    </odc:point>`;
}

function buildSegments(input: GpxTripInput): TripSegment[] {
  if (input.driving && input.driving.length > 0) {
    return [
      {
        role: "driving",
        mode: "driving",
        name: `${input.name} - driving`,
        description: `Driving route from ${pointName(input.originPoint)} to ${pointName(input.destinationPoint)}.`,
        from: {
          kind: "point",
          role: "origin",
          ref: input.originPoint?.id ?? "origin-point",
          name: pointName(input.originPoint)
        },
        to: {
          kind: "point",
          role: "destination",
          ref: input.destinationPoint?.id ?? "destination-point",
          name: pointName(input.destinationPoint)
        },
        coords: input.driving
      }
    ];
  }

  const segments: TripSegment[] = [
    {
      role: "walk-in",
      mode: "walking",
      name: `${input.name} - walk-in`,
      description: `Walking route from ${pointName(input.originPoint)} to ${stationName(input.originStation)}.`,
      from: {
        kind: "point",
        role: "origin",
        ref: input.originPoint?.id ?? "origin-point",
        name: pointName(input.originPoint)
      },
      to: {
        kind: "station",
        role: "origin",
        ref: input.originStation.id,
        name: stationName(input.originStation)
      },
      coords: input.walkIn
    },
    {
      role: "metro",
      mode: "metro",
      name: `${input.name} - metro`,
      description: `Metro route from ${stationName(input.originStation)} to ${stationName(input.destinationStation)}.`,
      from: {
        kind: "station",
        role: "origin",
        ref: input.originStation.id,
        name: stationName(input.originStation)
      },
      to: {
        kind: "station",
        role: "destination",
        ref: input.destinationStation.id,
        name: stationName(input.destinationStation)
      },
      coords: input.metro
    },
    {
      role: "walk-out",
      mode: "walking",
      name: `${input.name} - walk-out`,
      description: `Walking route from ${stationName(input.destinationStation)} to ${pointName(input.destinationPoint)}.`,
      from: {
        kind: "station",
        role: "destination",
        ref: input.destinationStation.id,
        name: stationName(input.destinationStation)
      },
      to: {
        kind: "point",
        role: "destination",
        ref: input.destinationPoint?.id ?? "destination-point",
        name: pointName(input.destinationPoint)
      },
      coords: input.walkOut
    }
  ];

  return segments.filter((segment) => segment.coords.length > 0);
}

export function buildTripGpx(input: GpxTripInput): string {
  const created = new Date().toISOString();
  const routeMode = resolvedRouteMode(input);
  const segments = buildSegments(input);
  const tracks = segments.map((segment, index) => trackToXml(segment, index + 1)).join("\n  ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="origin-destination-creator" xmlns="http://www.topografix.com/GPX/1/1" xmlns:odc="${ODC_GPX_NAMESPACE}">
  <metadata>
    <name>${escapeXml(input.name)}</name>
    <desc>${escapeXml(`${stationName(input.originStation)} -> ${stationName(input.destinationStation)}`)}</desc>
    <time>${created}</time>
    <extensions>
      <odc:trip${xmlAttrs({
        id: input.id,
        routeMode,
        schemaVersion: 1,
        segmentCount: segments.length
      })}>
        ${stationToXml("origin", input.originStation)}
        ${stationToXml("destination", input.destinationStation)}
        ${pointToXml("origin", input.originPoint)}
        ${pointToXml("destination", input.destinationPoint)}
      </odc:trip>
    </extensions>
  </metadata>
  ${tracks}
</gpx>`;
}
