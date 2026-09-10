import { normalizePointMode } from "./tripModes";
import { haversineDistanceM, toLatLon } from "./geo";
import type { LonLat, StructuredAddress, TripRouteMode, WalkPoint } from "./types";
import type { TransitJourney, TransitLeg, TransitMode } from "./transitTypes";

const ODC_GPX_NAMESPACE = "https://www.maximspur.com/origin-destination-creator/gpx/1";

type SegmentRole = "cycling" | "cycle-in" | "walk-in" | "metro" | "walk-out" | "driving" | "transit" | "transfer";
type SegmentMode = "cycling" | "walking" | "driving" | TransitMode;
type EndpointKind = "point" | "station" | "stop";
type EndpointRole = "origin" | "destination";

interface SegmentEndpoint {
  kind: EndpointKind;
  role: EndpointRole | "boarding" | "alighting";
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
  transitLeg?: TransitLeg;
  geometrySource?: TransitLeg["geometrySource"];
}

export interface GpxStationInput {
  kind?: "area" | "point";
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
  places?: boolean;
  id: string;
  name: string;
  pairKey?: string;
  routeMode?: TripRouteMode;
  originStation: GpxStationInput;
  destinationStation: GpxStationInput;
  originPoint?: GpxPointInput;
  destinationPoint?: GpxPointInput;
  walkIn: LonLat[];
  metro: LonLat[];
  walkOut: LonLat[];
  driving?: LonLat[];
  cycling?: LonLat[];
  accessMode?: "cycling";
  transitJourney?: TransitJourney;
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

function pointMode(point: GpxPointInput | undefined) {
  return normalizePointMode(point?.tripMode);
}

function resolvedRouteMode(input: GpxTripInput): TripRouteMode {
  if (input.routeMode) {
    return input.routeMode;
  }
  return input.cycling?.length ? "cycling" : input.driving?.length ? "driving" : "metro";
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

function segmentMetadataToXml(segment: TripSegment, index: number, distanceM: string): string {
  return `<odc:segment${xmlAttrs({
    index,
    role: segment.role,
    mode: segment.mode,
    pointCount: segment.coords.length,
    distanceM,
    geometrySource: segment.geometrySource,
    lineId: segment.transitLeg?.line?.id,
    lineName: segment.transitLeg?.line?.name,
    boardingStopId: segment.transitLeg?.from.id,
    alightingStopId: segment.transitLeg?.to.id
  })}>
        ${endpointToXml(segment.from, "odc:from")}
        ${endpointToXml(segment.to, "odc:to")}
      </odc:segment>`;
}

function segmentRefToXml(segment: TripSegment, index: number, distanceM: string): string {
  return `<odc:segmentRef${xmlAttrs({
    index,
    role: segment.role,
    mode: segment.mode,
    pointCount: segment.coords.length,
    distanceM,
    geometrySource: segment.geometrySource,
    lineId: segment.transitLeg?.line?.id,
    lineName: segment.transitLeg?.line?.name,
    boardingStopId: segment.transitLeg?.from.id,
    alightingStopId: segment.transitLeg?.to.id
  })} />`;
}

function segmentToXml(segment: TripSegment, index: number, distanceM: string): string {
  const points = segment.coords.map((coord) => trackPointToXml(coord)).join("\n      ");
  return `<trkseg>
      ${points}
      <extensions>
        ${segmentRefToXml(segment, index, distanceM)}
      </extensions>
    </trkseg>`;
}

function trackToXml(segment: TripSegment, index: number): string {
  const distanceM = formatDistance(segmentDistanceM(segment.coords));
  return `<trk>
    <name>${escapeXml(segment.name)}</name>
    <desc>${escapeXml(segment.description)}</desc>
    <type>${escapeXml(segment.mode)}</type>
    <extensions>
      ${segmentMetadataToXml(segment, index, distanceM)}
    </extensions>
    ${segmentToXml(segment, index, distanceM)}
  </trk>`;
}

function stationToXml(role: EndpointRole, station: GpxStationInput, places = false): string {
  return `<odc:${places ? "place" : "station"}${xmlAttrs({
    kind: places ? station.kind ?? "area" : undefined,
    role,
    id: station.id,
    name: station.name,
    lat: formatCoord(station.lat),
    lon: formatCoord(station.lon),
    radiusM: places && station.kind === "point" ? undefined : station.radiusM
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
  const direct = input.cycling?.length ? input.cycling : input.driving;
  const directMode = input.cycling?.length ? "cycling" : "driving";
  if (direct && direct.length > 0) {
    return [
      {
        role: directMode,
        mode: directMode,
        name: `${input.name} - ${directMode}`,
        description: `${directMode === "cycling" ? "Cycling" : "Driving"} route from ${pointName(input.originPoint)} to ${pointName(input.destinationPoint)}.`,
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
        coords: direct
      }
    ];
  }

  if (input.transitJourney) {
    const journey = input.transitJourney;
    const access = (role: "walk-in" | "walk-out"): TripSegment => {
      const inbound = role === "walk-in";
      const cycling = inbound && input.accessMode === "cycling";
      const accessRole = cycling ? "cycle-in" : role;
      const stop = inbound ? journey.from : journey.to;
      const point = inbound ? input.originPoint : input.destinationPoint;
      const pointEndpoint: SegmentEndpoint = {
        kind: "point", role: inbound ? "origin" : "destination",
        ref: point?.id ?? (inbound ? "origin-point" : "destination-point"), name: pointName(point)
      };
      const stopEndpoint: SegmentEndpoint = {
        kind: "stop", role: inbound ? "boarding" : "alighting", ref: stop.id, name: stop.name
      };
      return {
        role: accessRole, mode: cycling ? "cycling" : "walking", name: `${input.name} - ${accessRole}`,
        description: inbound ? `${cycling ? "Cycling" : "Walking"} route from ${pointName(point)} to ${stop.name}.${cycling ? " Bike left at boarding station; parking availability is unverified." : ""}`
          : `Walking route from ${stop.name} to ${pointName(point)}.`,
        from: inbound ? pointEndpoint : stopEndpoint, to: inbound ? stopEndpoint : pointEndpoint,
        coords: inbound ? input.walkIn : input.walkOut, geometrySource: "ors"
      };
    };
    return [access("walk-in"), ...journey.legs.map((leg): TripSegment => ({
      role: leg.kind, mode: leg.mode,
      name: `${input.name} - ${leg.line ? `${leg.mode.toUpperCase()} ${leg.line.name}` : "walking transfer"}`,
      description: `${leg.line ? `${leg.mode.toUpperCase()} ${leg.line.name}` : "Walking transfer"} from ${leg.from.name} to ${leg.to.name}.${leg.geometrySource === "station-connector" ? " Approximate station connector; not a routed pedestrian path." : ""}`,
      from: { kind: "stop", role: "boarding", ref: leg.from.id, name: leg.from.name },
      to: { kind: "stop", role: "alighting", ref: leg.to.id, name: leg.to.name },
      coords: leg.coordinates, transitLeg: leg, geometrySource: leg.geometrySource
    })), access("walk-out")].filter((segment) => segment.coords.length > 0);
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
        pairKey: input.pairKey,
        routeMode,
        schemaVersion: input.accessMode === "cycling" || routeMode === "cycling" ? 4 : input.places ? 3 : input.transitJourney ? 2 : 1,
        accessMode: input.accessMode,
        bikeParking: input.accessMode === "cycling" ? "unverified" : undefined,
        bikeHandling: input.accessMode === "cycling" ? "leave-at-boarding-station" : undefined,
        networkVersion: input.transitJourney?.networkVersion,
        transferCount: input.transitJourney?.transferCount,
        segmentCount: segments.length
      })}>
        ${stationToXml("origin", input.originStation, input.places)}
        ${stationToXml("destination", input.destinationStation, input.places)}
        ${pointToXml("origin", input.originPoint)}
        ${pointToXml("destination", input.destinationPoint)}${input.transitJourney ? '\n        <odc:source attribution="Île-de-France Mobilités" license="Licence Mobilité" licenseUrl="https://cloud.fabmob.io/s/eYWWJBdM3fQiFNm" geometryAttribution="© OpenStreetMap contributors" geometryLicense="ODbL" geometryLicenseUrl="https://opendatacommons.org/licenses/odbl/1-0/" url="https://prim.iledefrance-mobilites.fr/fr/jeux-de-donnees/offre-horaires-tc-gtfs-idfm" />' : ""}
      </odc:trip>
    </extensions>
  </metadata>
  ${tracks}
</gpx>`;
}
