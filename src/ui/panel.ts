import type { GenerationReport, StationCandidate, StationRecord, WalkPoint } from "../lib/types";

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
  randomRadiusM: number;
  nearbyCandidates: StationCandidate[];
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
  onGenerateRandomPoints: (stationId: string, count: number, radiusM: number) => void;
  onRandomDefaultsChange: (count: number, radiusM: number) => void;
  onTripCountChange: (tripCount: number) => void;
  onSeedChange: (seed?: number) => void;
  onGenerate: () => void;
  onDownload: () => void;
  onClearPreview: () => void;
  onResetAll: () => void;
}

function stationOption(station: StationRecord, selectedId: string | null): string {
  return `<option value="${station.id}" ${selectedId === station.id ? "selected" : ""}>${station.name}</option>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pointRow(point: WalkPoint, selectedPointId: string | null): string {
  const isSelected = point.id === selectedPointId;
  const label = point.label?.trim() || "Resolving address...";
  const status = point.addressStatus ?? "resolving";
  const statusText =
    status === "resolved" ? "Resolved" : status === "failed" ? "Lookup failed" : "Resolving";
  return `<tr data-point-id="${point.id}" class="${isSelected ? "is-selected" : ""}">
    <td>
      <span class="point-label">${escapeHtml(label)}</span>
      <span class="address-state ${status}">${statusText}</span>
    </td>
    <td class="point-actions">
      <button data-point-up type="button">↑</button>
      <button data-point-down type="button">↓</button>
      <button data-point-delete type="button">Delete</button>
    </td>
  </tr>`;
}

function stationCard(station: StationRecord, model: PanelModel): string {
  const isActive = station.id === model.activeStationId;
  const isOrigin = station.id === model.selectedOriginStationId;
  const isDestination = station.id === model.selectedDestinationStationId;

  return `<div class="station-card" data-station-id="${station.id}">
    <div class="station-title-row">
      <input data-station-name type="text" value="${station.name}" />
      <span>${station.walkPoints.length} points</span>
    </div>
    <div class="station-coords-row">
      <span class="station-coords-text">${station.lat.toFixed(5)}, ${station.lon.toFixed(5)}</span>
      <label>Radius m <input data-station-radius type="number" step="10" min="20" value="${station.radiusM}" /></label>
    </div>
    <div class="station-btn-row">
      <button data-set-active type="button" ${isActive ? "disabled" : ""}>${isActive ? "Active" : "Set active"}</button>
      <button data-set-origin type="button" ${isOrigin ? "disabled" : ""}>${isOrigin ? "Origin" : "Set origin"}</button>
      <button data-set-destination type="button" ${isDestination ? "disabled" : ""}>${isDestination ? "Destination" : "Set destination"}</button>
      <button data-delete-station type="button">Delete</button>
    </div>
  </div>`;
}

function reportHtml(model: PanelModel): string {
  if (!model.report) return "";
  const failures = model.report.failures
    .slice(0, 6)
    .map((failure) => `<li><code>${failure.code}</code> ${failure.message}</li>`)
    .join("");
  return `<div class="report-box">
    <strong>Generation report</strong>
    <div>Requested: ${model.report.requestedTrips} | Generated: ${model.report.generatedTrips} | Failed: ${model.report.failedTrips}</div>
    <div>Unique pairs: ${model.report.pairingStats.uniquePairsUsed} | Max pair reuse: ${model.report.pairingStats.maxPairReuse}</div>
    ${failures ? `<ul>${failures}</ul>` : ""}
  </div>`;
}

function progressHtml(model: PanelModel): string {
  const progress = model.generationProgress;
  if (!progress) return "";

  return `<div class="progress-box phase-${progress.phase}">
    <div class="progress-title">Generation progress</div>
    <div class="progress-message">${escapeHtml(progress.message)}</div>
    <div class="progress-meta">${progress.current}/${progress.total}</div>
    <div class="progress-bar-shell">
      <div class="progress-bar-fill" style="width:${Math.max(0, Math.min(100, progress.percent)).toFixed(1)}%"></div>
    </div>
  </div>`;
}

export function renderPanel(container: HTMLElement, model: PanelModel, callbacks: PanelCallbacks): void {
  const activeStation = model.stations.find((s) => s.id === model.activeStationId) ?? null;

  container.innerHTML = `
    <section>
      <h2>Settings</h2>
      <label>ORS API Key
        <input id="orsApiKey" type="password" value="${model.orsApiKey}" placeholder="Paste your key" />
      </label>
      <div class="btn-row">
        <button id="clearApiKey" type="button">Clear API key</button>
      </div>
      <label>Overpass URL
        <input id="overpassUrl" type="text" value="${model.overpassUrl}" />
      </label>
      <div class="mode-row">
        <button id="modeIdle" type="button" ${model.mode === "idle" ? "disabled" : ""}>Idle</button>
        <button id="modeAddStation" type="button" ${model.mode === "add_station" ? "disabled" : ""}>Map click: add station</button>
        <button id="modeAddPoint" type="button" ${model.mode === "add_point" ? "disabled" : ""} ${activeStation ? "" : "disabled"}>Map click: add point</button>
      </div>
      <div class="status-line">${model.statusText ?? ""}</div>
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
            .map((c) => `<option value="${c.id}">${c.name} (${c.lat.toFixed(5)}, ${c.lon.toFixed(5)})</option>`)
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
          <div><strong>${activeStation.name}</strong></div>
          <div class="points-help">Click a map point to select it. Click map elsewhere to move selected point. Press Delete/Backspace to remove selected point.</div>
          <div class="btn-row">
            <label>Random count <input id="randomCount" type="number" min="1" value="${model.randomCount}" /></label>
            <label>Random radius m <input id="randomRadius" type="number" min="20" step="10" value="${model.randomRadiusM}" /></label>
            <button id="addRandomPoints" type="button">Generate random points</button>
          </div>
          <table class="points-table">
            <thead><tr><th>Label</th><th>Actions</th></tr></thead>
            <tbody>
              ${activeStation.walkPoints.map((point) => pointRow(point, model.selectedPointId)).join("")}
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
      ${reportHtml(model)}
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

    const radiusInput = stationElement.querySelector<HTMLInputElement>("[data-station-radius]");
    radiusInput?.addEventListener("change", () => callbacks.onUpdateStation(stationId, { radiusM: Number(radiusInput.value) }));
  }

  if (activeStation) {
    const randomCountInput = container.querySelector<HTMLInputElement>("#randomCount");
    const randomRadiusInput = container.querySelector<HTMLInputElement>("#randomRadius");

    const getCount = () => Math.max(1, Number(randomCountInput?.value ?? model.randomCount));
    const getRadius = () => Math.max(20, Number(randomRadiusInput?.value ?? model.randomRadiusM));

    randomCountInput?.addEventListener("change", () => callbacks.onRandomDefaultsChange(getCount(), getRadius()));
    randomRadiusInput?.addEventListener("change", () => callbacks.onRandomDefaultsChange(getCount(), getRadius()));

    container.querySelector<HTMLButtonElement>("#addRandomPoints")?.addEventListener("click", () => {
      callbacks.onGenerateRandomPoints(activeStation.id, getCount(), getRadius());
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

    if (model.selectedPointId) {
      const selectedRow = container.querySelector<HTMLElement>(`tr[data-point-id="${model.selectedPointId}"]`);
      if (selectedRow) {
        selectedRow.scrollIntoView({ block: "nearest" });
      }
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
}
