import type { LonLat } from "./types";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function segmentToXml(coords: LonLat[]): string {
  const points = coords
    .map(([lon, lat]) => `<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}" />`)
    .join("\n      ");
  return `<trkseg>\n      ${points}\n    </trkseg>`;
}

export interface GpxTripInput {
  id: string;
  name: string;
  originStationName: string;
  destinationStationName: string;
  walkIn: LonLat[];
  metro: LonLat[];
  walkOut: LonLat[];
}

export function buildTripGpx(input: GpxTripInput): string {
  const created = new Date().toISOString();
  const segments = [input.walkIn, input.metro, input.walkOut]
    .filter((segment) => segment.length > 0)
    .map((segment) => segmentToXml(segment))
    .join("\n    ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="origin-destination-creator" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(input.name)}</name>
    <time>${created}</time>
    <desc>${escapeXml(`${input.originStationName} -> ${input.destinationStationName}`)}</desc>
  </metadata>
  <trk>
    <name>${escapeXml(input.name)}</name>
    ${segments}
  </trk>
</gpx>`;
}
