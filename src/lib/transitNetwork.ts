import type { LatLon } from "./types";
import type { TransitNetwork } from "./transitTypes";

let pending: Promise<TransitNetwork> | undefined;

/** Regional dataset coverage; legacy geometry routing remains available elsewhere. */
export function isInTransitRegion(point: LatLon): boolean {
  return point.lat >= 48.1 && point.lat <= 49.3 && point.lon >= 1.4 && point.lon <= 3.6;
}

export function loadTransitNetwork(): Promise<TransitNetwork> {
  if (!pending) {
    pending = fetch(`${import.meta.env.BASE_URL}data/idfm-transit.json`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Unable to load the transit network (HTTP ${response.status}).`);
        const data = await response.json() as TransitNetwork;
        if (data.schemaVersion !== 1 || !data.version || !Array.isArray(data.stops)
          || !Array.isArray(data.patterns) || !Array.isArray(data.lines) || !Array.isArray(data.transfers)) {
          throw new Error("The transit network has an unsupported format.");
        }
        return data;
      })
      .catch((error) => {
        pending = undefined;
        throw error;
      });
  }
  return pending;
}
