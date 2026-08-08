import { bench, describe } from "vitest";

import type { GeneratedTrip, StationRecord } from "../../src/lib/types";
import {
  renderPanel,
  updateGenerationProgress,
  type PanelCallbacks,
  type PanelModel
} from "../../src/ui/panel";

const noop = () => undefined;
const callbacks: PanelCallbacks = {
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

const station: StationRecord = {
  id: "vincennes",
  name: "Vincennes",
  lat: 48.847,
  lon: 2.439,
  radiusM: 800,
  walkPoints: Array.from({ length: 250 }, (_, index) => ({
    id: `point-${index}`,
    lat: 48.847 + index / 1_000_000,
    lon: 2.439 + index / 1_000_000,
    label: `Vincennes point ${index}`,
    addressStatus: "resolved" as const,
    tripMode: "metro" as const
  }))
};

const trips: GeneratedTrip[] = Array.from({ length: 250 }, (_, index) => ({
  id: `trip-${index}`,
  pairKey: `pair-${index}`,
  fileName: `trip-${index}.gpx`,
  gpx: "<gpx />",
  routeMode: "metro" as const,
  originPoint: station.walkPoints[index],
  destinationPoint: { id: `destination-${index}`, lat: 48.84, lon: 2.59, label: `Géodata ${index}` },
  walkInCoords: [[2.439, 48.847]],
  metroCoords: [[2.5, 48.85]],
  walkOutCoords: [[2.59, 48.84]],
  drivingCoords: []
}));

const model: PanelModel = {
  mode: "idle",
  busy: true,
  stations: [station],
  activeStationId: station.id,
  selectedPointId: null,
  selectedOriginStationId: station.id,
  selectedDestinationStationId: null,
  orsApiKey: "",
  overpassUrl: "https://example.test",
  tripCount: 250,
  randomCount: 250,
  nearbyCandidates: [],
  generatedTrips: trips,
  selectedTripId: null,
  pointClocks: {},
  generationProgress: {
    phase: "assemble",
    message: "Composing trip GPX files",
    current: 125,
    total: 250,
    percent: 50
  },
  canDownload: true
};

const fullRenderContainer = document.createElement("div");
const progressContainer = document.createElement("div");
renderPanel(progressContainer, model, callbacks);

describe("panel (250 points + 250 trips)", () => {
  bench("full panel render", () => {
    renderPanel(fullRenderContainer, model, callbacks);
  });

  bench("incremental generation progress", () => {
    updateGenerationProgress(progressContainer, {
      phase: "assemble",
      message: "Composing trip GPX files",
      current: 126,
      total: 250,
      percent: 50.4
    });
  });
});
