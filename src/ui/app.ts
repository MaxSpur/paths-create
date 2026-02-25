import { downloadZip } from "../lib/exportZip";
import { reverseGeocodeLabel } from "../lib/geocode";
import { generateTrips } from "../lib/generator";
import { newId } from "../lib/ids";
import { fetchNearbyStations } from "../lib/overpassClient";
import { samplePointsWithinRadius } from "../lib/sampling";
import { createStateStore } from "../lib/stateStore";
import type { GenerationProgressUpdate } from "../lib/generator";
import type { GeneratedTrip, GenerationReport, StationCandidate, StationRecord, WalkPoint } from "../lib/types";
import { MapView } from "./map";
import { renderPanel } from "./panel";

interface GenerationArtifacts {
  report: GenerationReport;
  files: Array<{ fileName: string; content: string }>;
}

interface UiGenerationProgress {
  phase: string;
  message: string;
  current: number;
  total: number;
  percent: number;
}

interface PointClockState {
  phase: "debounce" | "queue" | "lookup";
  startedAt: number;
  targetAt: number;
  durationMs: number;
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
  let generationProgress: UiGenerationProgress | null = null;
  let scrollSelectedIntoView = false;
  const pointAddressTimers = new Map<string, number>();
  const pointClockStates = new Map<string, PointClockState>();
  let pointClockTicker: number | null = null;
  let requestUiRefresh: (() => void) | null = null;

  const ensurePointClockTicker = () => {
    const shouldRun = pointClockStates.size > 0;
    if (shouldRun && pointClockTicker === null) {
      pointClockTicker = window.setInterval(() => {
        requestUiRefresh?.();
      }, 200);
    } else if (!shouldRun && pointClockTicker !== null) {
      window.clearInterval(pointClockTicker);
      pointClockTicker = null;
    }
  };

  const clearPointClock = (pointId: string) => {
    if (pointClockStates.delete(pointId)) {
      ensurePointClockTicker();
    }
  };

  const setPointClock = (pointId: string, state: PointClockState) => {
    pointClockStates.set(pointId, state);
    ensurePointClockTicker();
  };

  const buildPointClockView = (
    pointIds: string[]
  ): Record<string, { phase: "debounce" | "queue" | "lookup"; progress: number; title: string }> => {
    const now = Date.now();
    const view: Record<string, { phase: "debounce" | "queue" | "lookup"; progress: number; title: string }> =
      {};

    for (const pointId of pointIds) {
      const state = pointClockStates.get(pointId);
      if (!state) continue;

      const remainingMs = Math.max(0, state.targetAt - now);
      const baseDuration = Math.max(1, state.durationMs);
      const countdownProgress = Math.max(0, Math.min(1, remainingMs / baseDuration));

      if (state.phase === "lookup") {
        const lookupMs = Math.max(0, now - state.startedAt);
        view[pointId] = {
          phase: "lookup",
          progress: (lookupMs % 1200) / 1200,
          title: `Resolving address: ${(Math.ceil(lookupMs / 100) / 10).toFixed(1)}s`
        };
      } else if (state.phase === "debounce") {
        const remainingSeconds = (Math.ceil(remainingMs / 100) / 10).toFixed(1);
        view[pointId] = {
          phase: "debounce",
          progress: countdownProgress,
          title: `Debouncing: ${remainingSeconds}s`
        };
      } else {
        if (remainingMs > 0) {
          const remainingSeconds = (Math.ceil(remainingMs / 100) / 10).toFixed(1);
          view[pointId] = {
            phase: "queue",
            progress: countdownProgress,
            title: `Queue wait: ${remainingSeconds}s`
          };
        } else {
          const queuedForMs = Math.max(0, now - state.startedAt);
          view[pointId] = {
            phase: "queue",
            progress: ((queuedForMs % 2000) / 2000),
            title: `Queued: ${(Math.ceil(queuedForMs / 100) / 10).toFixed(1)}s`
          };
        }
      }
    }

    return view;
  };

  const clearPointAddressTimer = (pointId: string) => {
    const timer = pointAddressTimers.get(pointId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      pointAddressTimers.delete(pointId);
    }
    clearPointClock(pointId);
  };

  const schedulePointAddressRefresh = (
    stationId: string,
    pointId: string,
    lat: number,
    lon: number,
    delayMs: number
  ) => {
    clearPointAddressTimer(pointId);
    const now = Date.now();
    setPointClock(pointId, {
      phase: "debounce",
      startedAt: now,
      targetAt: now + Math.max(0, delayMs),
      durationMs: Math.max(1, delayMs)
    });

    const timer = window.setTimeout(async () => {
      pointAddressTimers.delete(pointId);
      try {
        const label = await reverseGeocodeLabel(
          { lat, lon },
          {
            onQueued: ({ estimatedWaitMs }) => {
              const queuedNow = Date.now();
              setPointClock(pointId, {
                phase: "queue",
                startedAt: queuedNow,
                targetAt: queuedNow + Math.max(0, estimatedWaitMs),
                durationMs: Math.max(1, estimatedWaitMs)
              });
              requestUiRefresh?.();
            },
            onStarted: () => {
              const startedAt = Date.now();
              setPointClock(pointId, {
                phase: "lookup",
                startedAt,
                targetAt: startedAt,
                durationMs: 1
              });
              requestUiRefresh?.();
            }
          }
        );
        clearPointClock(pointId);
        store.update((draft) => {
          const station = draft.stations.find((item) => item.id === stationId);
          const point = station?.walkPoints.find((item) => item.id === pointId);
          if (!point) return draft;

          const samePosition =
            Math.abs(point.lat - lat) < 1e-7 && Math.abs(point.lon - lon) < 1e-7;
          if (!samePosition) {
            return draft;
          }

          point.label = label;
          point.addressStatus = "resolved";
          return draft;
        });
      } catch {
        clearPointClock(pointId);
        store.update((draft) => {
          const station = draft.stations.find((item) => item.id === stationId);
          const point = station?.walkPoints.find((item) => item.id === pointId);
          if (!point) return draft;

          const samePosition =
            Math.abs(point.lat - lat) < 1e-7 && Math.abs(point.lon - lon) < 1e-7;
          if (!samePosition) {
            return draft;
          }

          point.addressStatus = "failed";
          if (!point.label || point.label === "Resolving address...") {
            point.label = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
          }
          return draft;
        });
      }
    }, Math.max(0, delayMs));

    pointAddressTimers.set(pointId, timer);
  };

  const applyGenerationProgress = (update: GenerationProgressUpdate) => {
    const total = Math.max(1, update.total);
    const current = Math.min(total, Math.max(0, update.current));
    generationProgress = {
      phase: update.phase,
      message: update.message,
      current,
      total,
      percent: total > 0 ? (current / total) * 100 : 0
    };
  };

  const map = new MapView(
    mapElement,
    store.getState().ui.mapCenter,
    store.getState().ui.mapZoom,
    {
      onMapClick: (point) => {
        const state = store.getState();
        const activeStationId = state.ui.activeStationId;
        const selectedPointId = state.ui.selectedPointId;

        if (activeStationId && selectedPointId) {
          let moved = false;
          store.update((draft) => {
            const station = draft.stations.find((item) => item.id === activeStationId);
            const selectedPoint = station?.walkPoints.find((item) => item.id === selectedPointId);
            if (!selectedPoint) {
              draft.ui.selectedPointId = null;
              return draft;
            }
            selectedPoint.lat = point.lat;
            selectedPoint.lon = point.lon;
            selectedPoint.label = "Resolving address...";
            selectedPoint.addressStatus = "resolving";
            moved = true;
            return draft;
          });

          if (moved) {
            statusText = "Moved selected point.";
            schedulePointAddressRefresh(
              activeStationId,
              selectedPointId,
              point.lat,
              point.lon,
              2000
            );
          }
          render();
          return;
        }

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
            draft.ui.selectedPointId = null;
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
            label: "Resolving address...",
            addressStatus: "resolving"
          };
          store.update((draft) => {
            const station = draft.stations.find((s) => s.id === activeStationId);
            if (station) {
              station.walkPoints.push(newPoint);
              draft.ui.selectedPointId = null;
            }
            return draft;
          });
          statusText = `Added point to station ${activeStationId}.`;
          schedulePointAddressRefresh(
            activeStationId,
            newPoint.id,
            newPoint.lat,
            newPoint.lon,
            0
          );
          render();
        }
      },
      onStationClick: (stationId) => {
        store.update((draft) => {
          draft.ui.activeStationId = stationId;
          draft.ui.selectedPointId = null;
          return draft;
        });
        statusText = `Active station set.`;
        render();
      },
      onPointClick: (stationId, pointId) => {
        store.update((draft) => {
          draft.ui.activeStationId = stationId;
          if (draft.ui.selectedPointId === pointId) {
            draft.ui.selectedPointId = null;
          } else {
            draft.ui.selectedPointId = pointId;
          }
          return draft;
        });
        const selectedNow = store.getState().ui.selectedPointId;
        scrollSelectedIntoView = Boolean(selectedNow);
        statusText = selectedNow ? "Point selected." : "Point deselected.";
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
        draft.ui.selectedPointId = null;
      }
      return draft;
    });
  };

  const deleteStation = (stationId: string) => {
    const state = store.getState();
    const station = state.stations.find((item) => item.id === stationId);
    if (station) {
      for (const point of station.walkPoints) {
        clearPointAddressTimer(point.id);
      }
    }

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
        draft.ui.selectedPointId = null;
      }
      return draft;
    });
  };

  const updateStation = (
    stationId: string,
    patch: Partial<Pick<StationRecord, "name" | "radiusM">>
  ) => {
    store.update((draft) => {
      const station = draft.stations.find((item) => item.id === stationId);
      if (!station) return draft;
      if (patch.name !== undefined) station.name = patch.name;
      if (patch.radiusM !== undefined && Number.isFinite(patch.radiusM)) {
        station.radiusM = Math.max(20, patch.radiusM);
      }
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
    clearPointAddressTimer(pointId);
    store.update((draft) => {
      const station = draft.stations.find((item) => item.id === stationId);
      if (!station) return draft;
      station.walkPoints = station.walkPoints.filter((point) => point.id !== pointId);
      if (draft.ui.selectedPointId === pointId) {
        draft.ui.selectedPointId = null;
      }
      return draft;
    });
  };

  const deleteSelectedPoint = (): boolean => {
    const state = store.getState();
    const stationId = state.ui.activeStationId;
    const pointId = state.ui.selectedPointId;
    if (!stationId || !pointId) {
      return false;
    }
    deletePoint(stationId, pointId);
    return true;
  };

  const addRandomPoints = (stationId: string, count: number, radiusM: number) => {
    const state = store.getState();
    const station = state.stations.find((item) => item.id === stationId);
    if (!station) return;

    const sampledPoints = samplePointsWithinRadius(
      { lat: station.lat, lon: station.lon },
      count,
      radiusM,
      Math.random,
      "rnd"
    );
    const randomPoints = sampledPoints.map((point) => ({
      ...point,
      label: "Resolving address...",
      addressStatus: "resolving" as const
    }));

    store.update((draft) => {
      const target = draft.stations.find((item) => item.id === stationId);
      if (!target) return draft;
      target.walkPoints.push(...randomPoints);
      draft.randomPointDefaults.count = count;
      draft.randomPointDefaults.radiusM = radiusM;
      return draft;
    });

    randomPoints.forEach((point, index) => {
      schedulePointAddressRefresh(stationId, point.id, point.lat, point.lon, index * 50);
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
      draft.ui.selectedPointId = null;
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
    generationProgress = {
      phase: "setup",
      message: "Starting generation",
      current: 0,
      total: 1,
      percent: 0
    };
    render();

    try {
      const result = await generateTrips({
        orsApiKey: state.orsApiKey,
        overpassUrl: state.overpassUrl,
        originStation: origin,
        destinationStation: destination,
        tripCount: state.generation.tripCount,
        seed: state.generation.seed,
        onProgress: (update) => {
          applyGenerationProgress(update);
          render();
        }
      });

      previewTrips = result.trips;
      generationArtifacts = {
        report: result.report,
        files: result.trips.map((trip) => ({ fileName: trip.fileName, content: trip.gpx }))
      };
      generationProgress = {
        phase: "done",
        message: "Generation complete",
        current: 1,
        total: 1,
        percent: 100
      };
      statusText = `Generation complete: ${result.report.generatedTrips}/${result.report.requestedTrips}.`;
    } catch (error) {
      generationArtifacts = null;
      previewTrips = [];
      generationProgress = {
        phase: "done",
        message: "Generation failed",
        current: 0,
        total: 1,
        percent: 0
      };
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
    generationProgress = null;
    statusText = "Preview cleared.";
    render();
  };

  const resetAll = () => {
    if (!window.confirm("Reset all saved data (stations, points, settings, API key)?")) {
      return;
    }
    for (const timer of pointAddressTimers.values()) {
      window.clearTimeout(timer);
    }
    pointAddressTimers.clear();
    pointClockStates.clear();
    ensurePointClockTicker();
    store.reset();
    mode = "idle";
    nearbyCandidates = [];
    previewTrips = [];
    generationArtifacts = null;
    generationProgress = null;
    statusText = "All saved data reset.";
    render();
  };

  const render = () => {
    const state = store.getState();
    const activeStation = state.stations.find((item) => item.id === state.ui.activeStationId);
    const pointClocks = buildPointClockView(activeStation?.walkPoints.map((point) => point.id) ?? []);

    map.render({
      stations: state.stations,
      activeStationId: state.ui.activeStationId,
      selectedPointId: state.ui.selectedPointId,
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
        selectedPointId: state.ui.selectedPointId,
        selectedOriginStationId: state.selectedOriginStationId,
        selectedDestinationStationId: state.selectedDestinationStationId,
        orsApiKey: state.orsApiKey,
        overpassUrl: state.overpassUrl,
        tripCount: state.generation.tripCount,
        seed: state.generation.seed,
        randomCount: state.randomPointDefaults.count,
        randomRadiusM: state.randomPointDefaults.radiusM,
        nearbyCandidates,
        pointClocks,
        scrollSelectedIntoView,
        generationProgress: generationProgress ?? undefined,
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
        onSelectPoint: (stationId, pointId) => {
          const stateNow = store.getState();
          const station = stateNow.stations.find((item) => item.id === stationId);
          const point = station?.walkPoints.find((item) => item.id === pointId);

          store.update((draft) => {
            draft.ui.activeStationId = stationId;
            draft.ui.selectedPointId = pointId;
            return draft;
          });
          if (point) {
            map.focusOnPoint({ lat: point.lat, lon: point.lon });
          }
          scrollSelectedIntoView = false;
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
    scrollSelectedIntoView = false;
  };

  requestUiRefresh = render;

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Delete" && event.key !== "Backspace") {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable)
    ) {
      return;
    }

    if (deleteSelectedPoint()) {
      event.preventDefault();
      statusText = "Selected point deleted.";
      render();
    }
  });

  store.subscribe(() => {
    render();
  });

  render();
}
