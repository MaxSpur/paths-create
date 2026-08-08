import { downloadZip } from "../lib/exportZip";
import { reverseGeocode, searchLocations } from "../lib/geocode";
import { generateTrips } from "../lib/generator";
import { newId } from "../lib/ids";
import { fetchNearbyStations } from "../lib/overpassClient";
import { pairKey } from "../lib/pairing";
import { samplePointsWithinRadius } from "../lib/sampling";
import { clampStationRadiusM, DEFAULT_STATION_RADIUS_M } from "../lib/stationRadius";
import { createStateStore } from "../lib/stateStore";
import type { GenerationProgressUpdate } from "../lib/generator";
import type { GeneratedTrip, GenerationReport, LatLon, StationCandidate, StationRecord, WalkPoint } from "../lib/types";
import { resolveMapClickAction, type EditMode } from "./interaction";
import { MapView } from "./map";
import { renderPanel, updateGenerationProgress, updatePointClocks, type PointClockView } from "./panel";
import { createRenderScheduler } from "./renderScheduler";

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
  let generatedTrips: GeneratedTrip[] = [];
  let selectedTripId: string | null = null;
  let lastGenerationReport: GenerationReport | null = null;
  let nextGeneratedTripNumber = 1;
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
  ): Record<string, PointClockView> => {
    const now = Date.now();
    const view: Record<string, PointClockView> = {};

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
        const geocoded = await reverseGeocode(
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

          point.label = geocoded.label;
          point.address = geocoded.address;
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
          point.address = undefined;
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
        const action = resolveMapClickAction({
          mode,
          point,
          stations: state.stations,
          activeStationId: state.ui.activeStationId,
          selectedPointId: state.ui.selectedPointId
        });

        switch (action.type) {
          case "activate_station":
            setActiveStation(action.stationId);
            statusText = "Active station set.";
            render();
            return;
          case "deselect_point":
            if (clearSelectedPoint()) {
              statusText = "Point deselected.";
              render();
            }
            return;
          case "move_point":
            moveSelectedPoint(action.stationId, action.pointId, point);
            render();
            return;
          case "add_point":
            addPointToStation(action.stationId, point);
            render();
            return;
          case "add_station":
            addStationAtPoint(point);
            render();
            return;
          case "noop":
            return;
        }
      },
      onStationClick: (stationId) => {
        setActiveStation(stationId);
        statusText = "Active station set.";
        render();
      },
      onPointClick: (stationId, pointId) => {
        togglePointSelection(stationId, pointId, {
          focusPoint: false,
          scrollIntoView: true
        });
      },
      onViewChange: (point, zoom) => {
        store.update((draft) => {
          draft.ui.mapCenter = point;
          draft.ui.mapZoom = zoom;
          return draft;
        }, { notify: false });
      },
      onLocationSearch: async (query, bounds) => {
        return searchLocations(query, {
          limit: 8,
          viewBox: bounds
        });
      }
    }
  );

  const getStation = (stationId: string | null): StationRecord | null => {
    if (!stationId) {
      return null;
    }
    return store.getState().stations.find((station) => station.id === stationId) ?? null;
  };

  const setActiveStation = (stationId: string, focusMap = true) => {
    store.update((draft) => {
      draft.ui.activeStationId = stationId;
      draft.ui.selectedPointId = null;
      return draft;
    });

    if (focusMap) {
      window.requestAnimationFrame(() => {
        const station = getStation(stationId);
        if (station) {
          map.focusOnStation(station);
        }
      });
    }
  };

  const clearSelectedPoint = (): boolean => {
    const state = store.getState();
    if (!state.ui.selectedPointId) {
      return false;
    }

    store.update((draft) => {
      draft.ui.selectedPointId = null;
      return draft;
    });
    scrollSelectedIntoView = false;
    return true;
  };

  const addStationAtPoint = (point: LatLon) => {
    const name = `Station ${store.getState().stations.length + 1}`;
    const station: StationRecord = {
      id: newId("station"),
      name,
      lat: point.lat,
      lon: point.lon,
      radiusM: DEFAULT_STATION_RADIUS_M,
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

    map.focusOnStation(station);
    statusText = `Added station ${name}.`;
  };

  const addPointToStation = (stationId: string, point: LatLon) => {
    const station = getStation(stationId);
    if (!station) {
      statusText = "Select an active station first.";
      return;
    }

    const newPoint: WalkPoint = {
      id: newId("pt"),
      lat: point.lat,
      lon: point.lon,
      label: "Resolving address...",
      addressStatus: "resolving",
      tripMode: "metro"
    };

    store.update((draft) => {
      const targetStation = draft.stations.find((item) => item.id === stationId);
      if (!targetStation) {
        return draft;
      }
      targetStation.walkPoints.push(newPoint);
      draft.ui.selectedPointId = null;
      return draft;
    });

    schedulePointAddressRefresh(stationId, newPoint.id, newPoint.lat, newPoint.lon, 0);
    statusText = `Added point to ${station.name}.`;
  };

  const moveSelectedPoint = (stationId: string, pointId: string, point: LatLon) => {
    let moved = false;
    let stationName = stationId;

    store.update((draft) => {
      const station = draft.stations.find((item) => item.id === stationId);
      if (!station) {
        draft.ui.selectedPointId = null;
        return draft;
      }

      const selectedPoint = station.walkPoints.find((item) => item.id === pointId);
      if (!selectedPoint) {
        draft.ui.selectedPointId = null;
        return draft;
      }

      stationName = station.name;
      selectedPoint.lat = point.lat;
      selectedPoint.lon = point.lon;
      selectedPoint.label = "Resolving address...";
      selectedPoint.address = undefined;
      selectedPoint.addressStatus = "resolving";
      moved = true;
      return draft;
    });

    if (!moved) {
      statusText = "Point deselected.";
      return;
    }

    schedulePointAddressRefresh(stationId, pointId, point.lat, point.lon, 2000);
    statusText = `Moved selected point in ${stationName}.`;
  };

  const togglePointSelection = (
    stationId: string,
    pointId: string,
    options: { focusPoint: boolean; scrollIntoView: boolean }
  ) => {
    const state = store.getState();
    const station = state.stations.find((item) => item.id === stationId);
    const point = station?.walkPoints.find((item) => item.id === pointId);
    if (!station || !point) {
      return;
    }

    const isAlreadySelected =
      state.ui.activeStationId === stationId && state.ui.selectedPointId === pointId;

    store.update((draft) => {
      draft.ui.activeStationId = stationId;
      draft.ui.selectedPointId = isAlreadySelected ? null : pointId;
      return draft;
    });

    if (!isAlreadySelected && options.focusPoint) {
      map.focusOnPoint({ lat: point.lat, lon: point.lon });
    }

    scrollSelectedIntoView = !isAlreadySelected && options.scrollIntoView;
    statusText = isAlreadySelected ? "Point deselected." : "Point selected.";
    render();
  };

  const setStationSelection = (stationId: string, role: "origin" | "destination" | "active") => {
    if (role === "active") {
      setActiveStation(stationId);
      return;
    }

    store.update((draft) => {
      if (role === "origin") {
        draft.selectedOriginStationId = stationId;
      } else {
        draft.selectedDestinationStationId = stationId;
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
        station.radiusM = clampStationRadiusM(patch.radiusM);
      }
      return draft;
    });
  };

  const togglePointTripMode = (stationId: string, pointId: string) => {
    let nextStatusText = "Point mode unchanged.";
    store.update((draft) => {
      const station = draft.stations.find((item) => item.id === stationId);
      if (!station) return draft;
      const point = station.walkPoints.find((item) => item.id === pointId);
      if (!point) return draft;
      const nextMode = point.tripMode === "driving" ? "metro" : "driving";
      point.tripMode = nextMode;
      nextStatusText = nextMode === "driving" ? "Point set to driving mode." : "Point set to metro mode.";
      return draft;
    });
    statusText = nextStatusText;
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

  const generatedPairKeys = (): Set<string> => {
    return new Set(generatedTrips.map((trip) => trip.pairKey || pairKey(trip.originPoint.id, trip.destinationPoint.id)));
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

  const addRandomPoints = (stationId: string, count: number) => {
    const state = store.getState();
    const station = state.stations.find((item) => item.id === stationId);
    if (!station) return;

    const sampledPoints = samplePointsWithinRadius(
      { lat: station.lat, lon: station.lon },
      count,
      station.radiusM,
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
      return draft;
    });

    randomPoints.forEach((point, index) => {
      schedulePointAddressRefresh(stationId, point.id, point.lat, point.lon, index * 50);
    });
    statusText = `Added ${randomPoints.length} random points inside ${station.name}.`;
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
        radiusM: DEFAULT_STATION_RADIUS_M,
        walkPoints: []
      });
      draft.ui.activeStationId = stationId;
      draft.ui.selectedPointId = null;
      if (!draft.selectedOriginStationId) draft.selectedOriginStationId = stationId;
      if (!draft.selectedDestinationStationId) draft.selectedDestinationStationId = stationId;
      return draft;
    });

    const station = getStation(stationId);
    if (station) {
      map.focusOnStation(station);
    }
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
    const excludedPairKeys = generatedPairKeys();
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
        excludedPairKeys,
        startingTripNumber: nextGeneratedTripNumber,
        onProgress: (update) => {
          applyGenerationProgress(update);
          if (generationProgress && !updateGenerationProgress(panelElement, generationProgress)) {
            render();
          }
        }
      });

      const knownPairKeys = generatedPairKeys();
      const newTrips = result.trips.filter((trip) => !knownPairKeys.has(trip.pairKey));
      generatedTrips = [...generatedTrips, ...newTrips];
      nextGeneratedTripNumber += newTrips.length;
      lastGenerationReport = result.report;
      generationProgress = {
        phase: "done",
        message: "Generation complete",
        current: 1,
        total: 1,
        percent: 100
      };
      statusText = `Generation complete: added ${newTrips.length} new trip${newTrips.length === 1 ? "" : "s"} (${generatedTrips.length} total).`;
    } catch (error) {
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
    if (generatedTrips.length === 0) {
      statusText = "No generated GPX files available for download.";
      render();
      return;
    }

    const files = generatedTrips.map((trip) => ({ fileName: trip.fileName, content: trip.gpx }));
    await downloadZip(files, `generated-trips-${new Date().toISOString().slice(0, 19)}.zip`);
    statusText = `Downloaded ${files.length} GPX files.`;
    render();
  };

  const selectGeneratedTrip = (tripId: string) => {
    const trip = generatedTrips.find((item) => item.id === tripId);
    if (!trip) {
      selectedTripId = null;
      statusText = "Generated trip not found.";
      render();
      return;
    }

    selectedTripId = selectedTripId === tripId ? null : tripId;
    if (selectedTripId) {
      map.focusOnTrip(trip);
    }
    statusText = selectedTripId ? "Generated trip selected." : "Generated trip deselected.";
    render();
  };

  const deleteGeneratedTrip = (tripId: string) => {
    const beforeCount = generatedTrips.length;
    generatedTrips = generatedTrips.filter((trip) => trip.id !== tripId);
    if (selectedTripId === tripId) {
      selectedTripId = null;
    }
    statusText = generatedTrips.length < beforeCount ? "Generated trip deleted." : "Generated trip not found.";
    render();
  };

  const deleteAllGeneratedTrips = () => {
    generatedTrips = [];
    selectedTripId = null;
    lastGenerationReport = null;
    generationProgress = null;
    nextGeneratedTripNumber = 1;
    statusText = "Generated trip list cleared.";
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
    generatedTrips = [];
    selectedTripId = null;
    lastGenerationReport = null;
    nextGeneratedTripNumber = 1;
    generationProgress = null;
    statusText = "All saved data reset.";
    render();
  };

  const renderNow = () => {
    const state = store.getState();
    const activeStation = state.stations.find((item) => item.id === state.ui.activeStationId);
    const pointClocks = buildPointClockView(activeStation?.walkPoints.map((point) => point.id) ?? []);

    map.render({
      stations: state.stations,
      activeStationId: state.ui.activeStationId,
      selectedPointId: state.ui.selectedPointId,
      selectedTripId,
      selectedOriginStationId: state.selectedOriginStationId,
      selectedDestinationStationId: state.selectedDestinationStationId,
      previewTrips: generatedTrips
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
        nearbyCandidates,
        generatedTrips,
        selectedTripId,
        pointClocks,
        scrollSelectedIntoView,
        generationProgress: generationProgress ?? undefined,
        report: lastGenerationReport ?? undefined,
        canDownload: generatedTrips.length > 0,
        statusText
      },
      {
        onSetMode: (nextMode) => {
          mode = nextMode;
          if (nextMode !== "add_point") {
            clearSelectedPoint();
          }
          statusText =
            nextMode === "idle"
              ? "Idle mode."
              : nextMode === "add_station"
                ? "Click outside existing station radii to add stations."
                : "Click inside the active station radius to add a point or move the selected point.";
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
          statusText = "Active station set.";
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
          togglePointSelection(stationId, pointId, {
            focusPoint: true,
            scrollIntoView: false
          });
        },
        onDeletePoint: (stationId, pointId) => {
          deletePoint(stationId, pointId);
          render();
        },
        onTogglePointTripMode: (stationId, pointId) => {
          togglePointTripMode(stationId, pointId);
          render();
        },
        onGenerateRandomPoints: (stationId, count) => {
          addRandomPoints(stationId, count);
          render();
        },
        onRandomDefaultsChange: (count) => {
          store.update((draft) => {
            draft.randomPointDefaults.count = count;
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
        onSelectTrip: selectGeneratedTrip,
        onDeleteTrip: deleteGeneratedTrip,
        onDeleteAllTrips: deleteAllGeneratedTrips,
        onDownload: download,
        onResetAll: resetAll
      }
    );
    scrollSelectedIntoView = false;
  };

  const render = createRenderScheduler(renderNow);

  requestUiRefresh = () => {
    const state = store.getState();
    const activeStation = state.stations.find((item) => item.id === state.ui.activeStationId);
    updatePointClocks(panelElement, buildPointClockView(activeStation?.walkPoints.map((point) => point.id) ?? []));
  };

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

  renderNow();
}
