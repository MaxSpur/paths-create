import { createStateStore, createDefaultState, loadState, STORAGE_KEY } from "../lib/stateStore";
import { describe, expect, it } from "vitest";

describe("stateStore", () => {
  it("persists and rehydrates state", () => {
    const store = createStateStore();
    store.update((draft) => {
      draft.orsApiKey = "test-key";
      draft.overpassUrl = "https://example.com/interpreter";
      draft.stations.push({
        id: "st1",
        name: "Station 1",
        lat: 10,
        lon: 20,
        radiusM: 400,
        walkPoints: [
          {
            id: "p1",
            lat: 10.001,
            lon: 20.001,
            label: "a",
            address: {
              displayName: "Address A",
              components: {
                road: "Main Street",
                empty: ""
              }
            }
          }
        ]
      });
      draft.selectedOriginStationId = "st1";
      draft.selectedDestinationStationId = "st1";
      draft.ui.activeStationId = "st1";
      return draft;
    });

    const loaded = loadState();
    expect(loaded.orsApiKey).toBe("test-key");
    expect(loaded.stations).toHaveLength(1);
    expect(loaded.stations[0].walkPoints).toHaveLength(1);
    expect(loaded.stations[0].walkPoints[0]?.tripMode).toBe("metro");
    expect(loaded.stations[0].walkPoints[0]?.address).toEqual({
      displayName: "Address A",
      components: {
        road: "Main Street"
      }
    });
    expect(loaded.selectedOriginStationId).toBe("st1");
  });

  it("recovers from corrupted localStorage", () => {
    localStorage.setItem(STORAGE_KEY, "{not-json");
    const loaded = loadState();
    expect(loaded).toEqual(createDefaultState());
  });

  it("keeps points attached to station when station position changes", () => {
    const store = createStateStore();
    store.update((draft) => {
      draft.stations = [
        {
          id: "a",
          name: "A",
          lat: 1,
          lon: 1,
          radiusM: 500,
          walkPoints: [{ id: "pA", lat: 1.001, lon: 1.001 }]
        },
        {
          id: "b",
          name: "B",
          lat: 2,
          lon: 2,
          radiusM: 500,
          walkPoints: [{ id: "pB", lat: 2.001, lon: 2.001 }]
        }
      ];
      return draft;
    });

    store.update((draft) => {
      const stationA = draft.stations.find((s) => s.id === "a");
      if (stationA) {
        stationA.lat = 9;
        stationA.lon = 9;
      }
      return draft;
    });

    const state = store.getState();
    expect(state.stations.find((s) => s.id === "a")?.walkPoints.map((p) => p.id)).toEqual(["pA"]);
    expect(state.stations.find((s) => s.id === "b")?.walkPoints.map((p) => p.id)).toEqual(["pB"]);
  });

  it("normalizes invalid station selections to null", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...createDefaultState(),
        selectedOriginStationId: "missing",
        selectedDestinationStationId: "missing",
        ui: {
          activeStationId: "missing",
          mapCenter: { lat: 0, lon: 0 },
          mapZoom: 10
        }
      })
    );

    const loaded = loadState();
    expect(loaded.selectedOriginStationId).toBeNull();
    expect(loaded.selectedDestinationStationId).toBeNull();
    expect(loaded.ui.activeStationId).toBeNull();
  });
});
