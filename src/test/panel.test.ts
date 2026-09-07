import { describe, expect, it, vi } from "vitest";

import type { PanelCallbacks, PanelModel } from "../ui/panel";
import { renderPanel, updateGenerationProgress, updatePointClocks } from "../ui/panel";

import { transitJourneyFixture } from "./transitJourneyFixture";

function createCallbacks(): PanelCallbacks {
  const noop = () => undefined;
  return {
    onSetMode: noop,
    onApiKeyChange: noop,
    onClearApiKey: noop,
    onOverpassUrlChange: noop,
    onFindNearby: noop,
    onAddNearbyStation: noop,
    onSetOriginStation: noop,
    onSetDestinationStation: noop,
    onSetActiveStation: noop,
    onDeleteStation: noop,
    onUpdateStation: noop,
    onSelectPoint: noop,
    onDeletePoint: noop,
    onTogglePointTripMode: noop,
    onGenerateRandomPoints: noop,
    onRandomDefaultsChange: noop,
    onTripCountChange: noop,
    onSeedChange: noop,
    onGenerate: noop,
    onSelectTrip: noop,
    onDeleteTrip: noop,
    onDeleteAllTrips: noop,
    onDownload: noop,
    onResetAll: noop
  };
}

describe("renderPanel", () => {
  it("escapes dynamic text and attribute values", () => {
    const stationName = `<img src=x onerror="alert(1)"> Central`;
    const pointLabel = `<script>alert(2)</script> Crosswalk`;
    const candidateName = `<svg onload="alert(3)"> Candidate`;
    const tripFileName = `<img src=x onerror="alert(6)">.gpx`;
    const tripPointLabel = `<img src=x onerror="alert(7)"> Trip point`;
    const failureCode = `<bad_code>`;
    const failureMessage = `<img src=x onerror="alert(4)"> failed`;
    const container = document.createElement("div");
    const model: PanelModel = {
      mode: "idle",
      busy: false,
      stations: [
        {
          id: `station"><img src=x>`,
          name: stationName,
          lat: 52.52,
          lon: 13.405,
          radiusM: 500,
          walkPoints: [
            {
              id: `point"><img src=x>`,
              lat: 52.521,
              lon: 13.406,
              label: pointLabel,
              addressStatus: "resolved",
              tripMode: "driving"
            }
          ]
        }
      ],
      activeStationId: `station"><img src=x>`,
      selectedPointId: `point"><img src=x>`,
      selectedOriginStationId: null,
      selectedDestinationStationId: null,
      orsApiKey: `key"><img src=x>`,
      overpassUrl: `https://example.test/?q="><img src=x>`,
      tripCount: 1,
      randomCount: 1,
      nearbyCandidates: [
        {
          id: `candidate"><img src=x>`,
          name: candidateName,
          lat: 52.53,
          lon: 13.41,
          tags: {}
        }
      ],
      generatedTrips: [
        {
          id: `trip"><img src=x>`,
          pairKey: "origin-point::destination-point",
          fileName: tripFileName,
          gpx: "<gpx />",
          routeMode: "driving",
          originPoint: {
            id: "origin-point",
            lat: 52.521,
            lon: 13.406,
            label: tripPointLabel
          },
          destinationPoint: {
            id: "destination-point",
            lat: 52.522,
            lon: 13.407,
            label: "Destination"
          },
          walkInCoords: [],
          metroCoords: [],
          walkOutCoords: [],
          drivingCoords: [[13.406, 52.521], [13.407, 52.522]]
        }
      ],
      selectedTripId: `trip"><img src=x>`,
      pointClocks: {},
      report: {
        requestedTrips: 1,
        generatedTrips: 0,
        failedTrips: 1,
        failures: [{ code: failureCode, message: failureMessage }],
        pairingStats: {
          uniquePairsUsed: 0,
          maxPairReuse: 0
        },
        reuseStats: {
          metroPath: false,
          walkingLegs: 0,
          walkingLegRequests: 0
        },
        serviceStats: {
          overpassFallback: false
        }
      },
      canDownload: false,
      statusText: `<img src=x onerror="alert(5)"> status`
    };

    renderPanel(container, model, createCallbacks());

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector<HTMLInputElement>("[data-station-name]")?.value).toBe(stationName);
    expect(container.textContent).toContain(pointLabel);
    expect(container.textContent).toContain(candidateName);
    expect(container.textContent).toContain(tripFileName);
    expect(container.textContent).toContain(tripPointLabel);
    expect(container.textContent).toContain(failureCode);
    expect(container.textContent).toContain(failureMessage);
    expect(container.querySelector<HTMLButtonElement>("[data-point-trip-mode]")?.textContent).toBe("D");
  });

  it("preserves panel and station-list scroll positions across renders", () => {
    const container = document.createElement("div");
    const model: PanelModel = {
      mode: "idle",
      busy: false,
      stations: Array.from({ length: 8 }, (_, index) => ({
        id: `station-${index}`,
        name: `Station ${index}`,
        lat: 52.52 + index / 1000,
        lon: 13.405 + index / 1000,
        radiusM: 500,
        walkPoints: []
      })),
      activeStationId: "station-0",
      selectedPointId: null,
      selectedOriginStationId: null,
      selectedDestinationStationId: null,
      orsApiKey: "",
      overpassUrl: "https://example.test",
      tripCount: 1,
      randomCount: 1,
      nearbyCandidates: [],
      generatedTrips: [],
      selectedTripId: null,
      pointClocks: {},
      canDownload: false,
      statusText: "Initial"
    };

    renderPanel(container, model, createCallbacks());
    container.scrollTop = 120;
    const stationList = container.querySelector<HTMLElement>(".station-list");
    expect(stationList).not.toBeNull();
    stationList!.scrollTop = 80;

    renderPanel(container, { ...model, statusText: "Updated" }, createCallbacks());

    expect(container.scrollTop).toBe(120);
    expect(container.querySelector<HTMLElement>(".station-list")?.scrollTop).toBe(80);
  });

  it("updates point clocks without rebuilding the panel", () => {
    const container = document.createElement("div");
    const model: PanelModel = {
      mode: "idle",
      busy: false,
      stations: [
        {
          id: "station-1",
          name: "Station 1",
          lat: 52.52,
          lon: 13.405,
          radiusM: 500,
          walkPoints: [{ id: "point-1", lat: 52.521, lon: 13.406, label: "Resolving address...", tripMode: "metro" }]
        }
      ],
      activeStationId: "station-1",
      selectedPointId: null,
      selectedOriginStationId: null,
      selectedDestinationStationId: null,
      orsApiKey: "",
      overpassUrl: "https://example.test",
      tripCount: 1,
      randomCount: 1,
      nearbyCandidates: [],
      generatedTrips: [],
      selectedTripId: null,
      pointClocks: {
        "point-1": {
          phase: "debounce",
          progress: 0.5,
          title: "Debouncing: 1.0s"
        }
      },
      canDownload: false
    };

    renderPanel(container, model, createCallbacks());
    const originalRow = container.querySelector<HTMLElement>("tr[data-point-id='point-1']");
    expect(originalRow?.querySelector("[data-point-clock]")?.className).toContain("debounce");

    updatePointClocks(container, {
      "point-1": {
        phase: "lookup",
        progress: 0.25,
        title: "Resolving address: 0.3s"
      }
    });

    const updatedRow = container.querySelector<HTMLElement>("tr[data-point-id='point-1']");
    const clock = updatedRow?.querySelector<HTMLElement>("[data-point-clock]");
    expect(updatedRow).toBe(originalRow);
    expect(clock?.className).toContain("lookup");
    expect(clock?.title).toBe("Resolving address: 0.3s");
    expect(clock?.style.getPropertyValue("--clock-progress")).toBe("0.250");

    updatePointClocks(container, {});
    expect(updatedRow?.querySelector("[data-point-clock]")).toBeNull();
  });

  it("patches generation progress without rebuilding the panel", () => {
    const container = document.createElement("div");
    const model: PanelModel = {
      mode: "idle",
      busy: true,
      stations: [],
      activeStationId: null,
      selectedPointId: null,
      selectedOriginStationId: null,
      selectedDestinationStationId: null,
      orsApiKey: "",
      overpassUrl: "https://example.test",
      tripCount: 10,
      randomCount: 1,
      nearbyCandidates: [],
      generatedTrips: [],
      selectedTripId: null,
      pointClocks: {},
      generationProgress: {
        phase: "setup",
        message: "Starting",
        current: 0,
        total: 10,
        percent: 0
      },
      canDownload: false
    };

    renderPanel(container, model, createCallbacks());
    const originalBox = container.querySelector(".progress-box");
    expect(updateGenerationProgress(container, {
      phase: "assemble",
      message: "Composing trip GPX files",
      current: 7,
      total: 10,
      percent: 70
    })).toBe(true);

    expect(container.querySelector(".progress-box")).toBe(originalBox);
    expect(container.querySelector(".progress-box")?.className).toContain("phase-assemble");
    expect(container.querySelector(".progress-message")?.textContent).toBe("Composing trip GPX files");
    expect(container.querySelector(".progress-meta")?.textContent).toBe("7/10");
    expect((container.querySelector(".progress-bar-fill") as HTMLElement).style.width).toBe("70%");
  });

  it("renders generated trips and wires select/delete actions", () => {
    const container = document.createElement("div");
    const selectedTrips: string[] = [];
    const deletedTrips: string[] = [];
    let deleteAllClicked = false;
    const callbacks: PanelCallbacks = {
      ...createCallbacks(),
      onSelectTrip: (tripId) => selectedTrips.push(tripId),
      onDeleteTrip: (tripId) => deletedTrips.push(tripId),
      onDeleteAllTrips: () => {
        deleteAllClicked = true;
      }
    };
    const model: PanelModel = {
      mode: "idle",
      busy: false,
      stations: [
        {
          id: "origin-station",
          name: "Origin station",
          lat: 1.5,
          lon: 2.5,
          radiusM: 500,
          walkPoints: [{ id: "origin", lat: 1, lon: 2, label: "Resolved origin" }]
        },
        {
          id: "destination-station",
          name: "Destination station",
          lat: 3.5,
          lon: 4.5,
          radiusM: 500,
          walkPoints: [{ id: "destination", lat: 3, lon: 4, label: "Resolved destination" }]
        }
      ],
      activeStationId: null,
      selectedPointId: null,
      selectedOriginStationId: null,
      selectedDestinationStationId: null,
      orsApiKey: "",
      overpassUrl: "https://example.test",
      tripCount: 1,
      randomCount: 1,
      nearbyCandidates: [],
      generatedTrips: [
        {
          id: "trip-1",
          transitJourney: transitJourneyFixture(),
          pairKey: "origin::destination",
          fileName: "trip-1.gpx",
          gpx: "<gpx />",
          routeMode: "metro",
          originPoint: { id: "origin", lat: 1, lon: 2, label: "Origin point" },
          destinationPoint: { id: "destination", lat: 3, lon: 4, label: "Destination point" },
          walkInCoords: [[2, 1]],
          metroCoords: [[2.5, 1.5]],
          walkOutCoords: [[4, 3]],
          drivingCoords: []
        }
      ],
      selectedTripId: "trip-1",
      pointClocks: {},
      canDownload: true
    };

    renderPanel(container, model, callbacks);

    expect(container.querySelector(".trips-table")).not.toBeNull();
    expect(container.querySelector(".trip-mode")?.textContent).toBe("Transit");
    expect(container.textContent).toContain("Snapshot: fixture-1");
    expect(container.querySelector('a[href="https://cloud.fabmob.io/s/eYWWJBdM3fQiFNm"]')?.textContent).toBe("Licence Mobilité");
    expect(container.textContent).toContain("METRO 5 <&> → RER A · 1 change · Approximate station connector");
    expect(container.querySelector(".trip-label")?.querySelector("script")).toBeNull();
    expect(container.querySelector("tr[data-trip-id='trip-1']")?.className).toContain("is-selected");
    expect(container.querySelector(".trip-label")?.textContent).toBe("Resolved origin -> Resolved destination");

    container.querySelector<HTMLElement>("tr[data-trip-id='trip-1']")?.click();
    container.querySelector<HTMLButtonElement>("[data-trip-delete]")?.click();
    container.querySelector<HTMLButtonElement>("#deleteAllTrips")?.click();

    expect(selectedTrips).toEqual(["trip-1"]);
    expect(deletedTrips).toEqual(["trip-1"]);
    expect(deleteAllClicked).toBe(true);

    const scrolled: HTMLElement[] = [];
    const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    const scroll = vi.fn(function (this: HTMLElement) { scrolled.push(this); });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
    try {
      const unusualId = 'trip"[data-point-id="x]';
      model.generatedTrips[0].id = unusualId;
      model.selectedTripId = unusualId;
      model.scrollSelectedTripIntoView = true;
      renderPanel(container, model, callbacks);
      expect(scrolled).toEqual([container.querySelector("tr[data-trip-id]")]);
      expect(scrolled[0].classList.contains("is-selected")).toBe(true);
      expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
      model.scrollSelectedTripIntoView = false;
      renderPanel(container, model, callbacks);
      expect(scroll).toHaveBeenCalledTimes(1);
    } finally {
      if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }

  });
});
