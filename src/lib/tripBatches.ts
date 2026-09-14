import type {GeneratedBatch, GeneratedTrip} from "./types";
export const TRIP_PAGE_SIZE = 50;
export const BATCH_PAGE_SIZE = 10;
export function pageNumber(page: number, count: number, size: number): number {
  return Math.max(0, Math.min(Math.floor(page) || 0, Math.ceil(count / size) - 1));
}
export function revealTrip(batches: GeneratedBatch[], tripId: string) {
  for (const [batchIndex, batch] of batches.entries()) {
    const index = batch.trips.findIndex(trip => trip.id === tripId);
    if (index >= 0) return {batchId: batch.id, batchPage: Math.floor(batchIndex / BATCH_PAGE_SIZE), tripPage: Math.floor(index / TRIP_PAGE_SIZE)};
  }
  return null;
}
export function pageTrips(batch: GeneratedBatch | undefined, page: number): GeneratedTrip[] {
  if (!batch) return [];
  const start = pageNumber(page, batch.trips.length, TRIP_PAGE_SIZE) * TRIP_PAGE_SIZE;
  return batch.trips.slice(start, start + TRIP_PAGE_SIZE);
}
