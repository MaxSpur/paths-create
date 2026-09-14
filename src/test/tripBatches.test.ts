import {describe, expect, it} from "vitest";
import {pageTrips, revealTrip} from "../lib/tripBatches";
import {exportParts} from "../lib/batchExport";
import type {GeneratedBatch, GeneratedTrip} from "../lib/types";

function batch(index: number, count: number): GeneratedBatch {
  return {id: `batch-${index}`, name: "Batch", createdAt: "2026-09-10T12:00:00Z", report: {} as GeneratedBatch["report"],
    trips: Array.from({length: count}, (_, i) => ({id: `${index}-${i}`, fileName: `${i}.gpx`, exportInput: {id: `${index}-${i}`} as GeneratedTrip["exportInput"]}) as GeneratedTrip)};
}
describe("bounded trip batches", () => {
  it("reveals a selected trip across batch and trip pages", () => {
    const batches = Array.from({length: 15}, (_, i) => batch(i, 130));
    expect(revealTrip(batches, "12-122")).toEqual({batchId: "batch-12", batchPage: 1, tripPage: 2});
    expect(pageTrips(batches[12], 2)).toHaveLength(30);
    expect(pageTrips(batches[12], 999)).toHaveLength(30);
    expect(revealTrip(batches, "missing")).toBeNull();
  });
  it("partitions all trips without losing IDs, names, metadata or evaluating GPX", () => {
    const source = batch(0, 2001);
    source.trips.forEach(trip => Object.defineProperty(trip, "gpx", {get() {throw new Error("GPX should be on demand");}}));
    const parts = exportParts([source]);
    expect(parts.map(part => part.batch.trips.length)).toEqual([1000, 1000, 1]);
    expect(parts.flatMap(part => part.batch.trips.map(trip => trip.id))).toEqual(source.trips.map(trip => trip.id));
    expect(parts[2].fileNames).toEqual(["2000.gpx"]);
    expect(parts[0].batch.metadata?.name).toBe("Batch");
    expect(parts[0].batch.trips[0]).toBe(source.trips[0].exportInput);
  });
});
