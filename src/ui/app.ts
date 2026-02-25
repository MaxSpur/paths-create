import { downloadZip } from "../lib/exportZip";
import { generateTrips } from "../lib/generator";
import { newId } from "../lib/ids";
import { fetchNearbyStations } from "../lib/overpassClient";
import { samplePointsWithinRadius } from "../lib/sampling";
import { createStateStore } from "../lib/stateStore";
import type { GeneratedTrip, GenerationReport, StationCandidate, StationRecord, WalkPoint } from "../lib/types";
import { MapView } from "./map";
import { renderPanel } from "./panel";

interface GenerationArtifacts {
  report: GenerationReport;
  files: Array<{ fileName: string; content: string }>;
}

type EditMode = "idle" | "add_station" | "add_point";

export function createApp(root: HTMLElement): void {
  root.innerHTML = `
    <div class="app-shell">
      <aside id="controlPanel" class="panel"></aside>
      <main id="mapArea" class="map-area"></main>
    </div>
  `;

  const panelElement = root.querySelector<HTMLElement>("#controlPanel");
  const mapElement = root.querySelector<HTMLElement>("#mapArea");

  if (!panelElement || !mapElement) {
    throw new Error("Failed to initialize app layout.");
  }

  const store = createStateStore();
  let mode: EditMode = "idle";
  let busy = false;
  let statusText = "";
  let nearbyCandidates: StationCandidate[] = [];
  let previewTrips: GeneratedTrip[] = [];
  let generationArtifacts: GenerationArtifacts | null = null;

  const map = new MapView(
    mapElement,
    store.getState().ui.mapCenter,
    store.getState().ui.mapZoom,
    {
      onMapClick: (point) => {
        if (mode === "add_station") {
          const name = `Station ${store.getState().stations.length + 1}`;
          const station: StationRecord = {
            id: newId("station"),
            name,
            lat: point.lat,
            lon: point.lon,
            radiusM: 500,
            walkPoints: []
          };

          store.update((draft) => {
            draft.stations.push(station);
            draft.ui.activeStationId = station.id;
            if (!draft.selectedOriginStationId) {
              draft.selectedOriginStationId = station.id;
            }
            if (!draft.selectedDestinationStationId) {
              draft.selectedDestinationStationId = station.id;
            }
            return draft;
          });

          statusText = `Added station ${name}.`;
          render();
          return;
        }

        if (mode === "add_point") {
          const activeStationId = store.getState().ui.activeStationId;
          if (!activeStationId) {
            statusText = "Select an active station first.";
            render();
            return;
          }
          const newPoint: WalkPoint = {
            id: newId("pt"),
            lat: point.lat,
            lon: point.lon,
            label: "manual"
          };
          store.update((draft) => {
            const station = draft.stations.find((s) => s.id === activeStationId);
            if (station) {
              station.walkPoints.push(newPoint);
            }
            return draft;
          });
          statusText = `Added point to station ${activeStationId}.`;
          render();
        }
      },
      onStationClick: (stationId) => {
        store.update((draft) => {
          draft.ui.activeStationId = stationId;
          return draft;
        });
        statusText = `Active station set.`;
        render();
      },
      onViewChange: (point, zoom) => {
        store.update((draft) => {
          draft.ui.mapCenter = point;
          draft.ui.mapZoom = zoom;
          return draft;
        });
      }
    }
  );

  const setStationSelection = (stationId: string, role: "origin" | "destination" | "active") => {
    store.update((draft) => {
      if (role === "origin") {
        draft.selectedOriginStationId = stationId;
      } else if (role === "destination") {
        draft.selectedDestinationStationId = stationId;
      } else {
        draft.ui.activeStationId = stationId;
      }
      return draft;
    });
  };

  const deleteStation = (stationId: string) => {
    store.update((draft) => {
      draft.stations = draft.stations.filter((station) => station.id !== stationId);
      if (draft.selectedOriginStationId === stationId) {
        draft.selectedOriginStationId = null;
      }
      if (draft.selectedDestinationStationId === stationId) {
        draft.selectedDestinationStationId = null;
      }
      if (draft.ui.activeStationId === stationId) {
        draft.ui.activeStationId = null;
      }
      return draft;
    });
  };

  const updateStation = (
    stationId: string,
    patch: Partial<Pick<StationRecord, "name" | "lat" | "lon" | "radiusM">>
  ) => {
    store.update((draft) => {
      const station = draft.stations.find((item) => item.id === stationId);
      if (!station) return draft;
      if (patch.name !== undefined) station.name = patch.name;
      if (patch.lat !== undefined && Number.isFinite(patch.lat)) station.lat = patch.lat;
      if (patch.lon !== undefined && Number.isFinite(patch.lon)) station.lon = patch.lon;
      if (patch.radiusM !== undefined && Number.isFinite(patch.radiusM)) {
        station.radiusM = Math.max(20, patch.radiusM);
      }
      return draft;
    });
  };

  const updatePoint = (stationId: string, pointId: string, patch: Partial<WalkPoint>) => {
    store.update((draft) => {
      const station = draft.stations.find((item) => item.id === stationId);
      const point = station?.walkPoints.find((item) => item.id === pointId);
      if (!point) return draft;
      if (patch.label !== undefined) point.label = patch.label;
      if (patch.lat !== undefined && Number.isFinite(patch.lat)) point.lat = patch.lat;
      if (patch.lon !== undefined && Number.isFinite(patch.lon)) point.lon = patch.lon;
      return draft;
    });
  };

  const movePoint = (stationId: string, pointId: string, direction: "up" | "down") => {
    store.update((draft) => {
      const station = draft.stations.find((item) => item.id === stationId);
      if (!station) return draft;
      const index = station.walkPoints.findIndex((point) => point.id === pointId);
      if (index < 0) return draft;
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= station.walkPoints.length) return draft;
      const [item] = station.walkPoints.splice(index, 1);
      station.walkPoints.splice(target, 0, item);
      return draft;
    });
  };

  const deletePoint = (stationId: string, pointId: string) => {
    store.update((draft) => {
      const station = draft.stations.find((item) => item.id === stationId);
      if (!station) return draft;
      station.walkPoints = station.walkPoints.filter((point) => point.id !== pointId);
      return draft;
    });
  };

  const addRandomPoints = (stationId: string, count: number, radiusM: number) => {
    const state = store.getState();
    const station = state.stations.find((item) => item.id === stationId);
    if (!station) return;

    const randomPoints = samplePointsWithinRadius(
      { lat: station.lat, lon: station.lon },
      count,
      radiusM,
      Math.random,
      "rnd"
    );

    store.update((draft) => {
      const target = draft.stations.find((item) => item.id === stationId);
      if (!target) return draft;
      target.walkPoints.push(...randomPoints);
      draft.randomPointDefaults.count = count;
      draft.randomPointDefaults.radiusM = radiusM;
      return draft;
    });
  };

  const findNearbyStations = async () => {
    busy = true;
    statusText = "Searching nearby stations...";
    render();

    try {
      const state = store.getState();
      const center = map.getCenter();
      nearbyCandidates = await fetchNearbyStations(state.overpassUrl, center, 2200, 80);
      statusText = `Found ${nearbyCandidates.length} nearby station candidates.`;
    } catch (error) {
      statusText = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
      render();
    }
  };

  const addNearbyStation = (candidateId: string) => {
    const candidate = nearbyCandidates.find((item) => item.id === candidateId);
    if (!candidate) return;

    const stationId = newId("station");
    store.update((draft) => {
      draft.stations.push({
        id: stationId,
        name: candidate.name,
        lat: candidate.lat,
        lon: candidate.lon,
        radiusM: 500,
        walkPoints: []
      });
      draft.ui.activeStationId = stationId;
      if (!draft.selectedOriginStationId) draft.selectedOriginStationId = stationId;
      if (!draft.selectedDestinationStationId) draft.selectedDestinationStationId = stationId;
      return draft;
    });

    statusText = `Added station ${candidate.name}.`;
    render();
  };

  const runGeneration = async () => {
    const state = store.getState();
    const origin = state.stations.find((s) => s.id === state.selectedOriginStationId);
    const destination = state.stations.find((s) => s.id === state.selectedDestinationStationId);

    if (!origin || !destination) {
      statusText = "Select both origin and destination stations first.";
      render();
      return;
    }

    busy = true;
    statusText = "Generating trips...";
    render();

    try {
      const result = await generateTrips({
        orsApiKey: state.orsApiKey,
        overpassUrl: state.overpassUrl,
        originStation: origin,
        destinationStation: destination,
        tripCount: state.generation.tripCount,
        seed: state.generation.seed
      });

      previewTrips = result.trips;
      generationArtifacts = {
        report: result.report,
        files: result.trips.map((trip) => ({ fileName: trip.fileName, content: trip.gpx }))
      };
      statusText = `Generation complete: ${result.report.generatedTrips}/${result.report.requestedTrips}.`;
    } catch (error) {
      generationArtifacts = null;
      previewTrips = [];
      statusText = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
      render();
    }
  };

  const download = async () => {
    if (!generationArtifacts || generationArtifacts.files.length === 0) {
      statusText = "No generated GPX files available for download.";
      render();
      return;
    }

    await downloadZip(generationArtifacts.files, `generated-trips-${new Date().toISOString().slice(0, 19)}.zip`);
    statusText = `Downloaded ${generationArtifacts.files.length} GPX files.`;
    render();
  };

  const clearPreview = () => {
    previewTrips = [];
    generationArtifacts = null;
    statusText = "Preview cleared.";
    render();
  };

  const resetAll = () => {
    if (!window.confirm("Reset all saved data (stations, points, settings, API key)?")) {
      return;
    }
    store.reset();
    mode = "idle";
    nearbyCandidates = [];
    previewTrips = [];
    generationArtifacts = null;
    statusText = "All saved data reset.";
    render();
  };

  const render = () => {
    const state = store.getState();

    map.render({
      stations: state.stations,
      activeStationId: state.ui.activeStationId,
      selectedOriginStationId: state.selectedOriginStationId,
      selectedDestinationStationId: state.selectedDestinationStationId,
      previewTrips
    });

    renderPanel(
      panelElement,
      {
        mode,
        busy,
        stations: state.stations,
        activeStationId: state.ui.activeStationId,
        selectedOriginStationId: state.selectedOriginStationId,
        selectedDestinationStationId: state.selectedDestinationStationId,
        orsApiKey: state.orsApiKey,
        overpassUrl: state.overpassUrl,
        tripCount: state.generation.tripCount,
        seed: state.generation.seed,
        randomCount: state.randomPointDefaults.count,
        randomRadiusM: state.randomPointDefaults.radiusM,
        nearbyCandidates,
        report: generationArtifacts?.report,
        canDownload: Boolean(generationArtifacts && generationArtifacts.files.length > 0),
        statusText
      },
      {
        onSetMode: (nextMode) => {
          mode = nextMode;
          statusText = nextMode === "idle" ? "Idle mode." : nextMode === "add_station" ? "Click map to add stations." : "Click map to add points to active station.";
          render();
        },
        onApiKeyChange: (value) => {
          store.update((draft) => {
            draft.orsApiKey = value.trim();
            return draft;
          });
        },
        onClearApiKey: () => {
          store.update((draft) => {
            draft.orsApiKey = "";
            return draft;
          });
          statusText = "API key cleared.";
          render();
        },
        onOverpassUrlChange: (value) => {
          store.update((draft) => {
            draft.overpassUrl = value.trim();
            return draft;
          });
        },
        onFindNearby: findNearbyStations,
        onAddNearbyStation: addNearbyStation,
        onSetOriginStation: (stationId) => {
          setStationSelection(stationId, "origin");
          render();
        },
        onSetDestinationStation: (stationId) => {
          setStationSelection(stationId, "destination");
          render();
        },
        onSetActiveStation: (stationId) => {
          setStationSelection(stationId, "active");
          render();
        },
        onDeleteStation: (stationId) => {
          deleteStation(stationId);
          render();
        },
        onUpdateStation: (stationId, patch) => {
          updateStation(stationId, patch);
          render();
        },
        onUpdatePoint: (stationId, pointId, patch) => {
          updatePoint(stationId, pointId, patch);
          render();
        },
        onDeletePoint: (stationId, pointId) => {
          deletePoint(stationId, pointId);
          render();
        },
        onMovePoint: (stationId, pointId, direction) => {
          movePoint(stationId, pointId, direction);
          render();
        },
        onGenerateRandomPoints: (stationId, count, radiusM) => {
          addRandomPoints(stationId, count, radiusM);
          render();
        },
        onRandomDefaultsChange: (count, radiusM) => {
          store.update((draft) => {
            draft.randomPointDefaults.count = count;
            draft.randomPointDefaults.radiusM = radiusM;
            return draft;
          });
        },
        onTripCountChange: (tripCount) => {
          store.update((draft) => {
            draft.generation.tripCount = tripCount;
            return draft;
          });
        },
        onSeedChange: (seed) => {
          store.update((draft) => {
            draft.generation.seed = Number.isFinite(seed) ? seed : undefined;
            return draft;
          });
        },
        onGenerate: runGeneration,
        onDownload: download,
        onClearPreview: clearPreview,
        onResetAll: resetAll
      }
    );
  };

  store.subscribe(() => {
    render();
  });

  render();
}
