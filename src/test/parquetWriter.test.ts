// @vitest-environment node
import {readFileSync} from "node:fs";
import {beforeAll, describe, expect, it} from "vitest";
import init from "parquet-wasm/esm";
import {parquetMetadata, parquetReadObjects} from "hyparquet";
import {compressors} from "hyparquet-compressors";
import {writePathParquet} from "../lib/parquetWriter";
import type {GpxTripInput} from "../lib/gpxWriter";
import {transitJourneyFixture} from "./transitJourneyFixture";

const base: GpxTripInput = {
  id: "trip", name: 'École <&> "test"', places: true,
  originStation: {id: "o", name: "Origin", lat: 48.9, lon: 2.4, radiusM: 100},
  destinationStation: {id: "d", name: "Destination", lat: 48.84, lon: 2.58, radiusM: 100},
  originPoint: {id: "point", lat: 48.9, lon: 2.4, address: {components: {city: "Paris"}}},
  walkIn: [[2.400000000123, 48.900000000456], [2.4, 48.9]], metro: [], walkOut: [[2.58, 48.84]]
};
const buffer = (bytes: Uint8Array) => Uint8Array.from(bytes).buffer;
beforeAll(async () => {await init({module_or_path: readFileSync("node_modules/parquet-wasm/esm/parquet_wasm_bg.wasm")});});

describe("GeoParquet paths", () => {
  it("is readable by an independent reader and preserves modes, leg order, metadata and exact coordinates", async () => {
    const trip = {...base, accessMode: "cycling" as const, transitJourney: transitJourneyFixture()};
    const file = buffer(writePathParquet([{id: "batch", trips: [trip]}]));
    const rows = await parquetReadObjects({file, compressors});
    expect(rows.map(row => row.mode)).toEqual(["cycling", "metro", "walking", "rer", "walking"]);
    expect(rows.map(row => row.leg_index)).toEqual([0, 1, 2, 3, 4]);
    expect(rows[0].geometry).toEqual({type: "LineString", coordinates: base.walkIn});
    expect(rows[4].geometry).toEqual({type: "Point", coordinates: base.walkOut[0]});
    expect(rows[2].geometry_source).toBe("station-connector");
    expect(rows[1].line_id).toBe('line-"5');
    const details = JSON.parse(rows[0].trip_json as string);
    expect(details.originPoint.address.components.city).toBe("Paris");
    expect(details.name).toBe(base.name);
    expect(details.bikeParking).toBe("unverified");
    expect(JSON.parse(rows[1].leg_json as string).transitLeg.line.color).toBe("#E18F43");
    const metadata = parquetMetadata(file).key_value_metadata!;
    const geo = JSON.parse(metadata.find(item => item.key === "geo")!.value!);
    expect(geo).toMatchObject({version: "1.1.0", primary_column: "geometry", columns: {geometry: {encoding: "WKB", geometry_types: ["LineString", "Point"]}}});
  });
  it("preserves 3D driving and cycling geometry and permits trip IDs reused in different batches", async () => {
    const trip = {...base, walkIn: [], walkOut: [], driving: [[2.4, 48.9, 30.123456789], [2.58, 48.84, -2]] as GpxTripInput["driving"]};
    const file = buffer(writePathParquet([{id: "a", trips: [trip]}, {id: "b", trips: [{...trip, driving: undefined, cycling: trip.driving}]}]));
    const rows = await parquetReadObjects({file, compressors});
    expect(rows.map(row => row.mode)).toEqual(["driving", "cycling"]);
    expect(rows[0].geometry).toEqual({type: "LineString", coordinates: trip.driving});
    expect(rows[1].geometry).toEqual(rows[0].geometry);
  });
  it("rejects empty paths, invalid coordinates, mixed dimensions and ambiguous IDs", () => {
    expect(() => writePathParquet([])).toThrow("No trips");
    expect(() => writePathParquet([{id: "a", trips: [{...base, walkIn: [], walkOut: []}]}])).toThrow("no path");
    expect(() => writePathParquet([{id: "a", trips: [base, base]}])).toThrow("Trip IDs");
    expect(() => writePathParquet([{id: "a", trips: [base]}, {id: "a", trips: [base]}])).toThrow("Batch IDs");
    expect(() => writePathParquet([{id: "a", trips: [{...base, walkIn: [[2, 48, 5], [2, 48]]}]}])).toThrow("mixed dimensions");
    expect(() => writePathParquet([{id: "a", trips: [{...base, walkIn: [[NaN, 48]]}]}])).toThrow("Invalid coordinates");
  });
});
