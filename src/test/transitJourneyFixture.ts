import type { TransitJourney, TransitStop } from "../lib/transitTypes";

/** Synthetic connected two-line journey; never calls a public service. */
export function transitJourneyFixture(): TransitJourney {
  const stops: TransitStop[] = [
    { id: "stop-origin", name: "Origin", lat: 48.9, lon: 2.4 },
    { id: "stop-change-1", name: "Change <&>", lat: 48.87, lon: 2.37 },
    { id: "stop-change-2", name: "Change B", lat: 48.871, lon: 2.371 },
    { id: "stop-destination", name: "Destination", lat: 48.84, lon: 2.58 }
  ];
  return {
    from: stops[0], to: stops[3], transferCount: 1, networkVersion: "fixture-1",
    legs: [
      {
        kind: "transit", mode: "metro", from: stops[0], to: stops[1],
        line: { id: 'line-"5', name: "5 <&>", mode: "metro", color: "#E18F43" },
        coordinates: [[2.4, 48.9], [2.37, 48.87]], geometrySource: "gtfs"
      },
      {
        kind: "transfer", mode: "walking", from: stops[1], to: stops[2],
        coordinates: [[2.37, 48.87], [2.371, 48.871]], geometrySource: "station-connector"
      },
      {
        kind: "transit", mode: "rer", from: stops[2], to: stops[3],
        line: { id: "line-A", name: "A", mode: "rer", color: "EB2132" },
        coordinates: [[2.371, 48.871], [2.58, 48.84]], geometrySource: "gtfs"
      }
    ]
  };
}
