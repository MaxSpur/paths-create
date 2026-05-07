import type { GenerationReport, StationCandidate, StationRecord, WalkPoint } from "../lib/types";
import {
  formatStationRadius,
  STATION_RADIUS_SLIDER_STEPS,
  stationRadiusMetersToSlider,
  stationRadiusSliderToMeters
} from "../lib/stationRadius";
import { escapeHtml } from "./html";

export interface PointClockView {
  phase: "debounce" | "queue" | "lookup";
  progress: number;
  title: string;
}

export interface PanelModel {
  mode: "idle" | "add_station" | "add_point";
  busy: boolean;
  stations: StationRecord[];
  activeStationId: string | null;
  selectedPointId: string | null;
  selectedOriginStationId: string | null;
  selectedDestinationStationId: string | null;
  orsApiKey: string;
  overpassUrl: string;
  tripCount: number;
  seed?: number;
  randomCount: number;
  nearbyCandidates: StationCandidate[];
  pointClocks: Record<string, PointClockView>;
  scrollSelectedIntoView?: boolean;
  generationProgress?: {
    phase: string;
    message: string;
    current: number;
    total: number;
    percent: number;
  };
  report?: GenerationReport;
  canDownload: boolean;
  statusText?: string;
}

export interface PanelCallbacks {
  onSetMode: (mode: PanelModel["mode"]) => void;
  onApiKeyChange: (value: string) => void;
  onClearApiKey: () => void;
  onOverpassUrlChange: (value: string) => void;
  onFindNearby: () => void;
  onAddNearbyStation: (candidateId: string) => void;
  onSetOriginStation: (stationId: string) => void;
  onSetDestinationStation: (stationId: string) => void;
  onSetActiveStation: (stationId: string) => void;
  onDeleteStation: (stationId: string) => void;
  onUpdateStation: (stationId: string, patch: Partial<Pick<StationRecord, "name" | "radiusM">>) => void;
  onSelectPoint: (stationId: string, pointId: string) => void;
  onDeletePoint: (stationId: string, pointId: string) => void;
  onMovePoint: (stationId: string, pointId: string, direction: "up" | "down") => void;
  onGenerateRandomPoints: (stationId: string, count: number) => void;
  onRandomDefaultsChange: (count: number) => void;
  onTripCountChange: (tripCount: number) => void;
  onSeedChange: (seed?: number) => void;
  onGenerate: () => void;
  onDownload: () => void;
  onClearPreview: () => void;
  onResetAll: () => void;
}

function stationOption(station: StationRecord, selectedId: string | null): string {
  return `<option value="${escapeHtml(station.id)}" ${selectedId === station.id ? "selected" : ""}>${escapeHtml(station.name)}</option>`;
}

function pointRow(
  point: WalkPoint,
  selectedPointId: string | null,
  pointClock?: PointClockView
): string {
  const isSelected = point.id === selectedPointId;
  const label = point.label?.trim() || "Resolving address...";
  return `<tr data-point-id="${escapeHtml(point.id)}" class="${isSelected ? "is-selected" : ""}">
    <td>
      <span class="point-label">${escapeHtml(label)}</span>
    </td>
    <td class="point-actions">
      <div class="point-actions-inner">
        ${
          pointClock
            ? pointClockHtml(pointClock)
            : ""
        }
        <button data-point-up type="button">↑</button>
        <button data-point-down type="button">↓</button>
        <button data-point-delete type="button">Delete</button>
      </div>
    </td>
  </tr>`;
}

function pointClockHtml(pointClock: PointClockView): string {
  return `<span data-point-clock class="point-clock-dial ${pointClock.phase}" title="${escapeHtml(pointClock.title)}" style="--clock-progress:${Math.max(
    0,
    Math.min(1, pointClock.progress)
  ).toFixed(3)}"></span>`;
}

function applyPointClockElementState(element: HTMLElement, pointClock: PointClockView): void {
  element.className = `point-clock-dial ${pointClock.phase}`;
  element.title = pointClock.title;
  element.style.setProperty("--clock-progress", Math.max(0, Math.min(1, pointClock.progress)).toFixed(3));
}

export function updatePointClocks(container: HTMLElement, pointClocks: Record<string, PointClockView>): void {
  for (const row of Array.from(container.querySelectorAll<HTMLElement>("tr[data-point-id]"))) {
    const pointId = row.dataset.pointId;
    if (!pointId) continue;

    const pointClock = pointClocks[pointId];
    const actions = row.querySelector<HTMLElement>(".point-actions-inner");
    if (!actions) continue;

    let clockElement = actions.querySelector<HTMLElement>("[data-point-clock]");
    if (!pointClock) {
      clockElement?.remove();
      continue;
    }

    if (!clockElement) {
      clockElement = document.createElement("span");
      clockElement.dataset.pointClock = "";
      actions.prepend(clockElement);
    }

    applyPointClockElementState(clockElement, pointClock);
  }
}

interface PanelScrollState {
  panelScrollTop: number;
  stationListScrollTop: number | null;
}

function capturePanelScroll(container: HTMLElement): PanelScrollState {
  return {
    panelScrollTop: container.scrollTop,
    stationListScrollTop: container.querySelector<HTMLElement>(".station-list")?.scrollTop ?? null
  };
}

function restorePanelScroll(container: HTMLElement, scrollState: PanelScrollState): void {
  container.scrollTop = scrollState.panelScrollTop;
  if (scrollState.stationListScrollTop !== null) {
    const stationList = container.querySelector<HTMLElement>(".station-list");
    if (stationList) {
      stationList.scrollTop = scrollState.stationListScrollTop;
    }
  }
}

function stationCard(station: StationRecord, model: PanelModel): string {
  const isActive = station.id === model.activeStationId;
  const isOrigin = station.id === model.selectedOriginStationId;
  const isDestination = station.id === model.selectedDestinationStationId;
  const radiusReadout = formatStationRadius(station.radiusM);

  return `<div class="station-card" data-station-id="${escapeHtml(station.id)}">
    <div class="station-title-row">
      <input data-station-name type="text" value="${escapeHtml(station.name)}" />
      <span>${station.walkPoints.length} points</span>
    </div>
    <div class="station-coords-row">
      <span class="station-coords-text">${station.lat.toFixed(5)}, ${station.lon.toFixed(5)}</span>
    </div>
    <label class="station-radius-field">
      <span class="station-radius-header">
        <span>Radius</span>
        <strong data-station-radius-readout>${radiusReadout}</strong>
      </span>
      <input
        data-station-radius-slider
        type="range"
        min="0"
        max="${STATION_RADIUS_SLIDER_STEPS}"
        step="1"
        value="${stationRadiusMetersToSlider(station.radiusM)}"
        aria-label="Station radius"
      />
    </label>
    <div class="station-btn-row">
      <button data-set-active type="button" ${isActive ? "disabled" : ""}>${isActive ? "Active" : "Set active"}</button>
      <button data-set-origin type="button" ${isOrigin ? "disabled" : ""}>${isOrigin ? "Origin" : "Set origin"}</button>
      <button data-set-destination type="button" ${isDestination ? "disabled" : ""}>${isDestination ? "Destination" : "Set destination"}</button>
      <button data-delete-station type="button">Delete</button>
    </div>
  </div>`;
}

function progressHtml(model: PanelModel): string {
  const progress = model.generationProgress;
  const report = model.report;
  if (!progress && !report) return "";

  const title = progress ? "Generation process" : "Generation complete";
  const message = progress ? progress.message : "Completed";
  const current = progress ? progress.current : report?.requestedTrips ?? 0;
  const total = progress ? progress.total : report?.requestedTrips ?? 0;
  const percent = progress ? progress.percent : 100;
  const failures = report
    ? report.failures
        .slice(0, 6)
        .map((failure) => `<li><code>${escapeHtml(failure.code)}</code> ${escapeHtml(failure.message)}</li>`)
        .join("")
    : "";

  return `<div class="progress-box phase-${progress?.phase ?? "done"}">
    <div class="progress-title">${title}</div>
    <div class="progress-message">${escapeHtml(message)}</div>
    <div class="progress-meta">${current}/${total}</div>
    <div class="progress-bar-shell">
      <div class="progress-bar-fill" style="width:${Math.max(0, Math.min(100, percent)).toFixed(1)}%"></div>
    </div>
    ${
      report
        ? `<div class="progress-report">
            <div>Requested: ${report.requestedTrips} | Generated: ${report.generatedTrips} | Failed: ${report.failedTrips}</div>
            <div>Unique pairs: ${report.pairingStats.uniquePairsUsed} | Max pair reuse: ${report.pairingStats.maxPairReuse}</div>
            ${failures ? `<ul>${failures}</ul>` : ""}
          </div>`
        : ""
    }
  </div>`;
}

export function renderPanel(container: HTMLElement, model: PanelModel, callbacks: PanelCallbacks): void {
  const activeStation = model.stations.find((s) => s.id === model.activeStationId) ?? null;
  const scrollState = capturePanelScroll(container);

  container.innerHTML = `
    <section>
      <h2>Settings</h2>
      <label>ORS API Key
        <input id="orsApiKey" type="password" value="${escapeHtml(model.orsApiKey)}" placeholder="Paste your key" />
      </label>
      <div class="btn-row">
        <button id="clearApiKey" type="button">Clear API key</button>
      </div>
      <label>Overpass URL
        <input id="overpassUrl" type="text" value="${escapeHtml(model.overpassUrl)}" />
      </label>
      <div class="mode-row">
        <button id="modeIdle" type="button" ${model.mode === "idle" ? "disabled" : ""}>Idle</button>
        <button id="modeAddStation" type="button" ${model.mode === "add_station" ? "disabled" : ""}>Map click: add station</button>
        <button id="modeAddPoint" type="button" ${model.mode === "add_point" ? "disabled" : ""} ${activeStation ? "" : "disabled"}>Map click: add point</button>
      </div>
      <div class="status-line">${escapeHtml(model.statusText ?? "")}</div>
    </section>

    <section>
      <h2>Stations</h2>
      <div class="btn-row">
        <button id="findNearby" type="button" ${model.busy ? "disabled" : ""}>Find nearby stations at map center</button>
      </div>
      <div class="nearby-row">
        <select id="nearbySelect">
          <option value="">Select nearby station</option>
          ${model.nearbyCandidates
            .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} (${c.lat.toFixed(5)}, ${c.lon.toFixed(5)})</option>`)
            .join("")}
        </select>
        <button id="addNearby" type="button">Add selected</button>
      </div>
      <label>Origin station
        <select id="originStationSelect">
          <option value="">None</option>
          ${model.stations.map((s) => stationOption(s, model.selectedOriginStationId)).join("")}
        </select>
      </label>
      <label>Destination station
        <select id="destinationStationSelect">
          <option value="">None</option>
          ${model.stations.map((s) => stationOption(s, model.selectedDestinationStationId)).join("")}
        </select>
      </label>
      <div class="station-list">${model.stations.map((s) => stationCard(s, model)).join("")}</div>
    </section>

    <section>
      <h2>Active Station Points</h2>
      ${
        activeStation
          ? `
          <div><strong>${escapeHtml(activeStation.name)}</strong></div>
          <div class="points-help">Click a map point to select it. In add-point mode, clicks inside the active station radius add a point or move the selected point. Clicks outside the radius deselect the point or activate another station if its radius was hit.</div>
          <div class="btn-row">
            <label>Random count <input id="randomCount" type="number" min="1" value="${model.randomCount}" /></label>
            <div class="station-radius-note">Uses station radius ${formatStationRadius(activeStation.radiusM)}</div>
            <button id="addRandomPoints" type="button">Generate random points</button>
          </div>
          <table class="points-table">
            <thead><tr><th>Label</th><th>Actions</th></tr></thead>
            <tbody>
              ${activeStation.walkPoints
                .map((point) => pointRow(point, model.selectedPointId, model.pointClocks[point.id]))
                .join("")}
            </tbody>
          </table>
        `
          : `<div>Select an active station first.</div>`
      }
    </section>

    <section>
      <h2>Generate Trips</h2>
      <label>Trip count
        <input id="tripCount" type="number" min="1" value="${model.tripCount}" />
      </label>
      <label>Seed (optional)
        <input id="seed" type="number" step="1" value="${model.seed ?? ""}" placeholder="empty = random" />
      </label>
      <div class="btn-row">
        <button id="generate" type="button" ${model.busy ? "disabled" : ""}>${model.busy ? "Generating..." : "Generate"}</button>
        <button id="clearPreview" type="button">Clear preview</button>
        <button id="download" type="button" ${model.canDownload ? "" : "disabled"}>Download GPX ZIP</button>
      </div>
      ${progressHtml(model)}
    </section>

    <section>
      <h2>Danger Zone</h2>
      <button id="resetAll" type="button" class="danger">Reset all saved data</button>
    </section>
  `;

  const apiKeyInput = container.querySelector<HTMLInputElement>("#orsApiKey");
  apiKeyInput?.addEventListener("change", () => callbacks.onApiKeyChange(apiKeyInput.value));

  const clearApiKeyBtn = container.querySelector<HTMLButtonElement>("#clearApiKey");
  clearApiKeyBtn?.addEventListener("click", callbacks.onClearApiKey);

  const overpassInput = container.querySelector<HTMLInputElement>("#overpassUrl");
  overpassInput?.addEventListener("change", () => callbacks.onOverpassUrlChange(overpassInput.value));

  container.querySelector<HTMLButtonElement>("#modeIdle")?.addEventListener("click", () => callbacks.onSetMode("idle"));
  container.querySelector<HTMLButtonElement>("#modeAddStation")?.addEventListener("click", () => callbacks.onSetMode("add_station"));
  container.querySelector<HTMLButtonElement>("#modeAddPoint")?.addEventListener("click", () => callbacks.onSetMode("add_point"));

  container.querySelector<HTMLButtonElement>("#findNearby")?.addEventListener("click", callbacks.onFindNearby);
  container.querySelector<HTMLButtonElement>("#addNearby")?.addEventListener("click", () => {
    const selectedId = container.querySelector<HTMLSelectElement>("#nearbySelect")?.value;
    if (selectedId) {
      callbacks.onAddNearbyStation(selectedId);
    }
  });

  container.querySelector<HTMLSelectElement>("#originStationSelect")?.addEventListener("change", (event) => {
    const stationId = (event.target as HTMLSelectElement).value;
    if (stationId) {
      callbacks.onSetOriginStation(stationId);
    }
  });

  container.querySelector<HTMLSelectElement>("#destinationStationSelect")?.addEventListener("change", (event) => {
    const stationId = (event.target as HTMLSelectElement).value;
    if (stationId) {
      callbacks.onSetDestinationStation(stationId);
    }
  });

  for (const stationElement of Array.from(container.querySelectorAll<HTMLElement>(".station-card"))) {
    const stationId = stationElement.dataset.stationId;
    if (!stationId) continue;

    stationElement.querySelector<HTMLButtonElement>("[data-set-active]")?.addEventListener("click", () => callbacks.onSetActiveStation(stationId));
    stationElement.querySelector<HTMLButtonElement>("[data-set-origin]")?.addEventListener("click", () => callbacks.onSetOriginStation(stationId));
    stationElement.querySelector<HTMLButtonElement>("[data-set-destination]")?.addEventListener("click", () => callbacks.onSetDestinationStation(stationId));
    stationElement.querySelector<HTMLButtonElement>("[data-delete-station]")?.addEventListener("click", () => callbacks.onDeleteStation(stationId));

    const nameInput = stationElement.querySelector<HTMLInputElement>("[data-station-name]");
    nameInput?.addEventListener("change", () => callbacks.onUpdateStation(stationId, { name: nameInput.value }));

    const radiusInput = stationElement.querySelector<HTMLInputElement>("[data-station-radius-slider]");
    const radiusReadout = stationElement.querySelector<HTMLElement>("[data-station-radius-readout]");
    const updateRadiusReadout = () => {
      if (!radiusInput || !radiusReadout) return;
      radiusReadout.textContent = formatStationRadius(stationRadiusSliderToMeters(Number(radiusInput.value)));
    };

    radiusInput?.addEventListener("input", updateRadiusReadout);
    radiusInput?.addEventListener("change", () => {
      if (!radiusInput) return;
      callbacks.onUpdateStation(stationId, {
        radiusM: stationRadiusSliderToMeters(Number(radiusInput.value))
      });
    });
  }

  if (activeStation) {
    const randomCountInput = container.querySelector<HTMLInputElement>("#randomCount");
    const getCount = () => Math.max(1, Number(randomCountInput?.value ?? model.randomCount));

    randomCountInput?.addEventListener("change", () => callbacks.onRandomDefaultsChange(getCount()));

    container.querySelector<HTMLButtonElement>("#addRandomPoints")?.addEventListener("click", () => {
      callbacks.onGenerateRandomPoints(activeStation.id, getCount());
    });

    for (const row of Array.from(container.querySelectorAll<HTMLElement>("tr[data-point-id]"))) {
      const pointId = row.dataset.pointId;
      if (!pointId) continue;

      row.addEventListener("click", () => callbacks.onSelectPoint(activeStation.id, pointId));

      row.querySelector<HTMLButtonElement>("[data-point-delete]")?.addEventListener("click", (event) => {
        event.stopPropagation();
        callbacks.onDeletePoint(activeStation.id, pointId);
      });
      row.querySelector<HTMLButtonElement>("[data-point-up]")?.addEventListener("click", (event) => {
        event.stopPropagation();
        callbacks.onMovePoint(activeStation.id, pointId, "up");
      });
      row.querySelector<HTMLButtonElement>("[data-point-down]")?.addEventListener("click", (event) => {
        event.stopPropagation();
        callbacks.onMovePoint(activeStation.id, pointId, "down");
      });
    }
  }

  const tripCountInput = container.querySelector<HTMLInputElement>("#tripCount");
  tripCountInput?.addEventListener("change", () => callbacks.onTripCountChange(Math.max(1, Number(tripCountInput.value))));

  const seedInput = container.querySelector<HTMLInputElement>("#seed");
  seedInput?.addEventListener("change", () => {
    const raw = seedInput.value.trim();
    callbacks.onSeedChange(raw ? Number(raw) : undefined);
  });

  container.querySelector<HTMLButtonElement>("#generate")?.addEventListener("click", callbacks.onGenerate);
  container.querySelector<HTMLButtonElement>("#download")?.addEventListener("click", callbacks.onDownload);
  container.querySelector<HTMLButtonElement>("#clearPreview")?.addEventListener("click", callbacks.onClearPreview);
  container.querySelector<HTMLButtonElement>("#resetAll")?.addEventListener("click", callbacks.onResetAll);

  if (model.scrollSelectedIntoView && model.selectedPointId) {
    const selectedRow = Array.from(container.querySelectorAll<HTMLElement>("tr[data-point-id]")).find(
      (row) => row.dataset.pointId === model.selectedPointId
    );
    selectedRow?.scrollIntoView({ block: "nearest" });
  } else {
    restorePanelScroll(container, scrollState);
  }
}
