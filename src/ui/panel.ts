import { normalizePointMode, nextPointMode, MODE_LABELS, MODE_SHORT } from "../lib/tripModes";
import type { GeneratedTrip, GenerationReport, LonLat, StationCandidate, StationRecord, WalkPoint } from "../lib/types";
import {
  formatStationRadius,
  STATION_RADIUS_SLIDER_STEPS,
  stationRadiusMetersToSlider,
  stationRadiusSliderToMeters
} from "../lib/stationRadius";
import { escapeHtml } from "./html";
import { haversineDistanceM, toLatLon } from "../lib/geo";

export interface PointClockView {
  phase: "debounce" | "queue" | "lookup";
  progress: number;
  title: string;
}

export interface PanelModel {
  mode: "idle" | "add_station" | "add_place_point" | "add_point" | "move_point" | "move_place";
  maxAccessDistanceM?: number;
  maxCyclingDistanceM?: number;
  maxTransfers?: number;
  busy: boolean;
  stations: StationRecord[];
  activeStationId: string | null;
  selectedPointId: string | null;
  selectedOriginStationId: string | null;
  selectedDestinationStationId: string | null;
  orsApiKey: string;
  routingProvider?: "hosted" | "local";
  overpassUrl: string;
  tripCount: number;
  seed?: number;
  randomCount: number;
  lookupAddresses?: boolean;
  nearbyCandidates: StationCandidate[];
  generatedTrips: GeneratedTrip[];
  selectedTripId: string | null;
  pointClocks: Record<string, PointClockView>;
  scrollSelectedIntoView?: boolean;
  scrollSelectedTripIntoView?: boolean;
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
  onRoutingProviderChange?: (provider: "hosted" | "local") => void;
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
  onTogglePointTripMode: (stationId: string, pointId: string) => void;
  onGenerateRandomPoints: (stationId: string, count: number) => void;
  onRandomDefaultsChange: (count: number) => void;
  onLookupAddressesChange?: (enabled: boolean) => void;
  onTripCountChange: (tripCount: number) => void;
  onSeedChange: (seed?: number) => void;
  onMaxAccessDistanceChange?: (distanceM: number) => void;
  onMaxCyclingDistanceChange?: (distanceM: number) => void;
  onMaxTransfersChange?: (maxTransfers: number) => void;
  onSwapPlaces?: () => void;
  onGenerate: () => void;
  onSelectTrip: (tripId: string) => void;
  onDeleteTrip: (tripId: string) => void;
  onDeleteAllTrips: () => void;
  onDownload: () => void;
  onResetAll: () => void;
}

function stationOption(station: StationRecord, selectedId: string | null): string {
  return `<option value="${escapeHtml(station.id)}" ${selectedId === station.id ? "selected" : ""}>${escapeHtml(station.name)}</option>`;
}

function pointRow(
  point: WalkPoint,
  selectedPointId: string | null,
  pointClock?: PointClockView,
  allowDelete = true
): string {
  const isSelected = point.id === selectedPointId;
  const label = point.label?.trim() || "Resolving address...";
  const tripMode = normalizePointMode(point.tripMode);
  const modeLabel = MODE_SHORT[tripMode];
  const modeTitle = `${MODE_LABELS[tripMode]}. Click for ${MODE_LABELS[nextPointMode(tripMode)]}.`;
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
        <button data-point-trip-mode type="button" class="point-trip-mode-button ${tripMode}" title="${escapeHtml(modeTitle)}" aria-label="${escapeHtml(modeTitle)}">${modeLabel}</button>
        ${allowDelete ? `<button data-point-delete type="button">Delete</button>` : ""}
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

function latestMatchingPoint(point: WalkPoint, stations: StationRecord[]): WalkPoint {
  return stations
    .flatMap((station) => station.walkPoints)
    .find((candidate) =>
      candidate.id === point.id
      && Math.abs(candidate.lat - point.lat) < 1e-7
      && Math.abs(candidate.lon - point.lon) < 1e-7
    ) ?? point;
}

function tripLabel(trip: GeneratedTrip, stations: StationRecord[]): string {
  const originPoint = latestMatchingPoint(trip.originPoint, stations);
  const destinationPoint = latestMatchingPoint(trip.destinationPoint, stations);
  const origin = originPoint.label?.trim() || originPoint.id;
  const destination = destinationPoint.label?.trim() || destinationPoint.id;
  return `${origin} -> ${destination}`;
}

function distanceLabel(paths: LonLat[][]): string {
  let distanceM = 0;
  for (const coords of paths) {
    for (let index = 1; index < coords.length; index++) {
      distanceM += haversineDistanceM(toLatLon(coords[index - 1]), toLatLon(coords[index]));
    }
  }
  return distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)} km` : `${Math.round(distanceM)} m`;
}

function tripRow(trip: GeneratedTrip, selectedTripId: string | null, stations: StationRecord[]): string {
  const isSelected = trip.id === selectedTripId;
  const modeLabel = trip.routeMode === "driving" ? "Driving" : trip.routeMode === "cycling" ? "Cycling" : trip.accessMode === "cycling" ? "Cycling + transit" : trip.transitJourney ? "Transit" : "Metro";
  const journey = trip.transitJourney;
  const rides = journey?.legs.filter((leg) => leg.kind === "transit") ?? [];
  const itinerary = journey ? `${rides
    .map((leg) => `${leg.mode.toUpperCase()} ${leg.line?.name ?? ""}`.trim()).join(" → ")} · ${journey.transferCount} change${journey.transferCount === 1 ? "" : "s"}${journey.legs.some((leg) => leg.geometrySource === "station-connector") ? " · Approximate station connector" : ""}` : "";
  const access = rides.length ? `${trip.accessMode === "cycling" ? `Bike access ${distanceLabel([trip.cyclingCoords ?? []])} · Exit walk ${distanceLabel([trip.walkOutCoords])}` : `Access + exit walk ${distanceLabel([trip.walkInCoords, trip.walkOutCoords])}`} · via ${rides[0].from.name} → ${rides[rides.length - 1].to.name}` : "";
  return `<tr data-trip-id="${escapeHtml(trip.id)}" class="${isSelected ? "is-selected" : ""}" title="${escapeHtml(trip.fileName)}">
    <td>
      <span class="trip-mode ${trip.routeMode}">${modeLabel}</span>
    </td>
    <td>
      <span class="trip-label">${escapeHtml(tripLabel(trip, stations))}</span>
      ${itinerary ? `<span class="trip-file trip-itinerary" title="${escapeHtml(itinerary)}">${escapeHtml(itinerary)}</span>` : ""}
      ${access ? `<span class="trip-file trip-access" title="${escapeHtml(access)} (street routes; station connectors and interchange walks excluded)">${escapeHtml(access)}</span>` : `<span class="trip-file">${escapeHtml(trip.fileName)}</span>`}
    </td>
    <td class="trip-actions">
      <button data-trip-delete type="button">Delete</button>
    </td>
  </tr>`;
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

export function updateGenerationProgress(
  container: HTMLElement,
  progress: NonNullable<PanelModel["generationProgress"]>
): boolean {
  const box = container.querySelector<HTMLElement>(".progress-box");
  const message = box?.querySelector<HTMLElement>(".progress-message");
  const meta = box?.querySelector<HTMLElement>(".progress-meta");
  const fill = box?.querySelector<HTMLElement>(".progress-bar-fill");
  if (!box || !message || !meta || !fill) {
    return false;
  }

  box.className = `progress-box phase-${progress.phase}`;
  message.textContent = progress.message;
  meta.textContent = `${progress.current}/${progress.total}`;
  fill.style.width = `${Math.max(0, Math.min(100, progress.percent)).toFixed(1)}%`;
  return true;
}

interface PanelScrollState {
  panelScrollTop: number;
  stationListScrollTop: number | null;
  generatedTripListScrollTop: number | null;
}

function capturePanelScroll(container: HTMLElement): PanelScrollState {
  return {
    panelScrollTop: container.scrollTop,
    stationListScrollTop: container.querySelector<HTMLElement>(".station-list")?.scrollTop ?? null,
    generatedTripListScrollTop: container.querySelector<HTMLElement>(".generated-trip-list")?.scrollTop ?? null
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
  if (scrollState.generatedTripListScrollTop !== null) {
    const generatedTripList = container.querySelector<HTMLElement>(".generated-trip-list");
    if (generatedTripList) {
      generatedTripList.scrollTop = scrollState.generatedTripListScrollTop;
    }
  }
}

function placeRow(station: StationRecord, model: PanelModel): string {
  const selected = station.id === model.activeStationId;
  return `<button type="button" class="place-row ${selected ? "is-selected" : ""}" data-place-id="${escapeHtml(station.id)}" aria-pressed="${selected}">
    <span class="place-row-main"><strong>${escapeHtml(station.name)}</strong><span class="place-row-meta">${station.kind === "point" ? "Single point" : `Area · ${station.walkPoints.length} points`}${selected ? " · Editing" : ""}</span></span>
    <span class="place-badges">${station.id === model.selectedOriginStationId ? `<span class="place-badge from">From</span>` : ""}${station.id === model.selectedDestinationStationId ? `<span class="place-badge to">To</span>` : ""}</span>
  </button>`;
}

function stationCard(station: StationRecord, model: PanelModel): string {
  const isOrigin = station.id === model.selectedOriginStationId;
  const isDestination = station.id === model.selectedDestinationStationId;
  return `<div class="station-card" data-station-id="${escapeHtml(station.id)}">
    <div class="place-editor-heading">Editing ${station.kind === "point" ? "single point" : "area"}</div>
    <label>Name<input data-station-name type="text" value="${escapeHtml(station.name)}" /></label>
    ${station.kind === "point" ? "" : `<label class="station-radius-field">
      <span class="station-radius-header"><span>Sampling radius</span><strong data-station-radius-readout>${formatStationRadius(station.radiusM)}</strong></span>
      <input data-station-radius-slider type="range" min="0" max="${STATION_RADIUS_SLIDER_STEPS}" step="1" value="${stationRadiusMetersToSlider(station.radiusM)}" aria-label="Sampling radius" />
    </label>`}
    <div class="station-btn-row">
      <button data-set-origin type="button" ${isOrigin ? "disabled" : ""}>${isOrigin ? "From" : "Set From"}</button>
      <button data-set-destination type="button" ${isDestination ? "disabled" : ""}>${isDestination ? "To" : "Set To"}</button>
      <button id="modeMovePlace" type="button" ${model.mode === "move_place" ? "disabled" : ""}>${station.kind === "point" ? "Move place" : "Move area &amp; points"}</button>
      <button data-delete-station type="button">Delete place</button>
    </div>
  </div>`;
}

function transitAttribution(trips: GeneratedTrip[]): string {
  const versions = [...new Set(trips.flatMap((trip) => trip.transitJourney ? [trip.transitJourney.networkVersion] : []))];
  if (versions.length === 0) return "";
  return `<div class="generated-trip-summary">Transit: <a href="https://prim.iledefrance-mobilites.fr/fr/jeux-de-donnees/offre-horaires-tc-gtfs-idfm" target="_blank" rel="noopener noreferrer">Île-de-France Mobilités</a>
    (<a href="https://cloud.fabmob.io/s/eYWWJBdM3fQiFNm" target="_blank" rel="noopener noreferrer">Licence Mobilité</a>).
    Shapes: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>
    (<a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer">ODbL</a>).
    Snapshot: ${escapeHtml(versions.join(", "))}.</div>`;
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
            <div>Reused this session: rail path ${report.reuseStats.metroPath ? "yes" : "no"} | Walking legs ${report.reuseStats.walkingLegs}/${report.reuseStats.walkingLegRequests}</div>
            <div>Rail setup: ${report.serviceStats.transitNetwork ? "Île-de-France transit network" : report.reuseStats.metroPath ? "session cache" : report.serviceStats.overpassFallback ? "documented backup Overpass endpoint" : "configured Overpass endpoint"}</div>
            ${failures ? `<ul>${failures}</ul>` : ""}
          </div>`
        : ""
    }
  </div>`;
}

export function renderPanel(container: HTMLElement, model: PanelModel, callbacks: PanelCallbacks): void {
  const activeStation = model.stations.find((s) => s.id === model.activeStationId) ?? null;
  const scrollState = capturePanelScroll(container);
  const oldFilter = container.querySelector<HTMLInputElement>("#placeFilter");
  const filterValue = oldFilter?.value ?? "";
  const filterFocused = oldFilter !== null && document.activeElement === oldFilter;
  const filterSelection = [oldFilter?.selectionStart ?? null, oldFilter?.selectionEnd ?? null] as const;
  const openDetails = new Set(Array.from(container.querySelectorAll<HTMLDetailsElement>("details[open][id]"), (detail) => detail.id));
  const firstRender = !container.querySelector("#placeFilter");
  const stations = [...model.stations].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const points = model.stations.filter(s => s.id === model.selectedOriginStationId || s.id === model.selectedDestinationStationId).flatMap(s => s.walkPoints);
  const hasCyclingAccess = points.some(p => p.tripMode === "cycling_transit");
  const hasTransit = points.some(p => ["metro", "cycling_transit"].includes(normalizePointMode(p.tripMode)));
  const placeNames = new Map(stations.map((station) => [station.id, station.name.toLocaleLowerCase()]));

  container.innerHTML = `
    <section>
      <h2>Places &amp; Areas</h2>
      <div class="points-help">Choose any location. Transit stops are selected for each trip.</div>
      <div class="btn-row place-create-row">
        <button id="modeAddStation" type="button" ${model.mode === "add_station" ? "disabled" : ""}>Add area</button>
        <button id="modeAddPlacePoint" type="button" ${model.mode === "add_place_point" ? "disabled" : ""}>Add single point</button>
        ${model.mode !== "idle" ? `<button id="modeIdle" type="button">Cancel placement</button>` : ""}
      </div>
      <label class="checkbox-label"><input id="lookupAddresses" type="checkbox" ${model.lookupAddresses !== false ? "checked" : ""} aria-describedby="addressLookupHelp" /> Look up point addresses</label>
      <div id="addressLookupHelp" class="points-help">New and moved points only. Turn off for faster point creation using coordinates.</div>
      <div class="status-line" role="status">${escapeHtml(model.statusText ?? "")}</div>
      <div class="place-endpoints">
        <label>From<select id="originStationSelect"><option value="" disabled ${model.selectedOriginStationId ? "" : "selected"}>Choose a place</option>${stations.map((s) => stationOption(s, model.selectedOriginStationId)).join("")}</select></label>
        <button id="swapPlaces" type="button" aria-label="Swap From and To" title="Swap From and To" ${!model.selectedOriginStationId || !model.selectedDestinationStationId ? "disabled" : ""}>⇄</button>
        <label>To<select id="destinationStationSelect"><option value="" disabled ${model.selectedDestinationStationId ? "" : "selected"}>Choose a place</option>${stations.map((s) => stationOption(s, model.selectedDestinationStationId)).join("")}</select></label>
      </div>
      <label>Saved places <span class="place-count">(${stations.length})</span><input id="placeFilter" type="search" placeholder="Filter places by name" value="${escapeHtml(filterValue)}" /></label>
      <div class="station-list" aria-label="Saved places">${stations.map((s) => placeRow(s, model)).join("")}</div>
      <div id="placeFilterEmpty" class="empty-list-note" hidden>No matching places.</div>
      ${stations.length === 0 ? `<div class="empty-list-note">Add an area to create a pool of points, or add a single point for one exact location.</div>` : ""}
      ${activeStation ? stationCard(activeStation, model) : stations.length ? `<div class="points-help">Select a saved place to edit its name and points. From and To stay unchanged.</div>` : ""}
      <details id="nearbyDetails" class="service-details" ${openDetails.has("nearbyDetails") ? "open" : ""}>
        <summary>Start from a transit station</summary>
        <div class="btn-row"><button id="findNearby" type="button" ${model.busy ? "disabled" : ""}>Find stations near map center</button></div>
        <div class="nearby-row"><select id="nearbySelect"><option value="">Select a station</option>${model.nearbyCandidates.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} (${c.lat.toFixed(5)}, ${c.lon.toFixed(5)})</option>`).join("")}</select><button id="addNearby" type="button">Add as area</button></div>
      </details>
    </section>

    ${activeStation ? `<section>
      <h2>${activeStation.kind === "point" ? "Point location" : "Points in this area"}</h2>
      <div><strong>${escapeHtml(activeStation.name)}</strong></div>
      <div class="points-help">${activeStation.kind === "point" ? "This place uses one exact location. Use Move place to reposition it." : "Add points inside this area's sampling radius. Select a point, then Move selected point to reposition it. Overlapping areas keep separate point pools."}</div>
      ${activeStation.kind === "point" ? "" : `<div class="btn-row">
        <button id="modeAddPoint" type="button" ${model.mode === "add_point" ? "disabled" : ""}>Add points on map</button>
        <button id="modeMovePoint" type="button" ${!model.selectedPointId || model.mode === "move_point" ? "disabled" : ""}>Move selected point</button>
      </div><div class="btn-row random-points-row"><label>Random count<input id="randomCount" type="number" min="1" value="${model.randomCount}" /></label><button id="addRandomPoints" type="button">Generate points</button></div>`}
      <table class="points-table"><thead><tr><th>Location</th><th>Mode / actions</th></tr></thead><tbody>${activeStation.walkPoints.map((point) => pointRow(point, model.selectedPointId, model.pointClocks[point.id], activeStation.kind !== "point")).join("")}</tbody></table>
      ${activeStation.walkPoints.length === 0 ? `<div class="empty-list-note">Add or generate points before using this area for trips.</div>` : ""}
    </section>` : ""}

    <section>
      <h2>Generate Trips</h2>
      <div class="points-help">Point modes: T transit (rail &amp; bus), D driving, C cycling, C+T cycling + transit. Click a point's mode to change it. If endpoints differ: D, then C, then C+T, then T.</div>
      ${hasCyclingAccess ? `<label>Maximum cycling access (m)<input id="maxCyclingDistance" type="number" min="100" max="20000" step="100" value="${model.maxCyclingDistanceM ?? 5000}" /></label><div class="points-help">Cycle to an RER station, leave the bike, then use transit and walk to the destination. Bike parking is assumed, not verified.</div>` : ""}
      ${hasTransit ? `<div class="routing-options"><label>Maximum access walk (m)<input id="maxAccessDistance" type="number" min="100" max="5000" step="100" value="${model.maxAccessDistanceM ?? 1500}" /></label><label>Maximum changes<select id="maxTransfers">${[0, 1, 2, 3].map((count) => `<option value="${count}" ${(model.maxTransfers ?? 3) === count ? "selected" : ""}>${count}</option>`).join("")}</select></label></div><div class="points-help">${hasCyclingAccess ? "Access limits are independent of the sampling radius." : "Walking limit applies at each end of a transit journey, independently of the sampling radius."}</div>` : ""}
      <label>Trip count
        <input id="tripCount" type="number" min="1" value="${model.tripCount}" />
      </label>
      <label>Seed (optional)
        <input id="seed" type="number" step="1" value="${model.seed ?? ""}" placeholder="empty = random" />
      </label>
      <div class="btn-row">
        <button id="generate" type="button" ${model.busy ? "disabled" : ""}>${model.busy ? "Generating..." : "Generate"}</button>
      </div>
      ${progressHtml(model)}
    </section>

    <section>
      <h2>Generated Trips</h2>
      ${transitAttribution(model.generatedTrips)}
      <div class="generated-trip-summary">${model.generatedTrips.length} trip${model.generatedTrips.length === 1 ? "" : "s"} in list</div>
      <div class="btn-row">
        <button id="download" type="button" ${model.canDownload ? "" : "disabled"}>Download GPX ZIP</button>
        <button id="deleteAllTrips" type="button" ${model.generatedTrips.length > 0 ? "" : "disabled"}>Delete all</button>
      </div>
      ${
        model.generatedTrips.length > 0
          ? `<div class="generated-trip-list">
              <table class="trips-table">
                <thead><tr><th>Mode</th><th>Trip</th><th>Actions</th></tr></thead>
                <tbody>
                  ${model.generatedTrips.map((trip) => tripRow(trip, model.selectedTripId, model.stations)).join("")}
                </tbody>
              </table>
            </div>`
          : `<div class="empty-list-note">Generated trips will be added here without replacing previous successful trips.</div>`
      }
    </section>

    <section>
      <details id="serviceSettings" class="service-details" ${openDetails.has("serviceSettings") || (firstRender && !model.orsApiKey && model.routingProvider !== "local") ? "open" : ""}>
        <summary>Service settings${model.routingProvider === "local" ? " · Local ORS" : model.orsApiKey ? "" : " · API key required"}</summary>
        <label>Routing service<select id="routingProvider"><option value="hosted" ${model.routingProvider !== "local" ? "selected" : ""}>Hosted ORS</option><option value="local" ${model.routingProvider === "local" ? "selected" : ""}>Local ORS</option></select></label>
        ${model.routingProvider === "local" ? `<div class="points-help">Local ORS at 127.0.0.1:8082. No API key or elevation required. Start the local server before generating.</div>` : `<label>ORS API key<input id="orsApiKey" type="password" value="${escapeHtml(model.orsApiKey)}" placeholder="Paste your key" /></label>
        <div class="btn-row"><button id="clearApiKey" type="button">Clear API key</button></div>`}
        <label>Overpass URL<input id="overpassUrl" type="text" value="${escapeHtml(model.overpassUrl)}" /></label>
      </details>
    </section>
    <section>
      <h2>Danger Zone</h2>
      <button id="resetAll" type="button" class="danger">Reset all saved data</button>
    </section>
  `;

  container.querySelector<HTMLSelectElement>("#routingProvider")?.addEventListener("change", event => callbacks.onRoutingProviderChange?.((event.target as HTMLSelectElement).value === "local" ? "local" : "hosted"));
  const filterInput = container.querySelector<HTMLInputElement>("#placeFilter");
  const filterPlaces = () => {
    const query = (filterInput?.value ?? "").trim().toLocaleLowerCase();
    let visibleCount = 0;
    for (const row of Array.from(container.querySelectorAll<HTMLElement>(".place-row"))) {
      const name = placeNames.get(row.dataset.placeId ?? "") ?? "";
      row.hidden = !name.includes(query);
      if (!row.hidden) visibleCount++;
    }
    const empty = container.querySelector<HTMLElement>("#placeFilterEmpty");
    if (empty) empty.hidden = visibleCount > 0 || stations.length === 0;
  };
  filterInput?.addEventListener("input", filterPlaces);
  filterPlaces();
  if (filterFocused && filterInput) {
    filterInput.focus({ preventScroll: true });
    filterInput.setSelectionRange(filterSelection[0], filterSelection[1]);
  }
  for (const row of Array.from(container.querySelectorAll<HTMLButtonElement>(".place-row"))) {
    row.addEventListener("click", () => { if (row.dataset.placeId) callbacks.onSetActiveStation(row.dataset.placeId); });
  }
  container.querySelector<HTMLButtonElement>("#swapPlaces")?.addEventListener("click", () => callbacks.onSwapPlaces?.());
  container.querySelector<HTMLInputElement>("#maxAccessDistance")?.addEventListener("change", (event) => callbacks.onMaxAccessDistanceChange?.(Number((event.target as HTMLInputElement).value)));
  container.querySelector<HTMLInputElement>("#maxCyclingDistance")?.addEventListener("change", (event) => callbacks.onMaxCyclingDistanceChange?.(Number((event.target as HTMLInputElement).value)));
  container.querySelector<HTMLSelectElement>("#maxTransfers")?.addEventListener("change", (event) => callbacks.onMaxTransfersChange?.(Number((event.target as HTMLSelectElement).value)));

  const apiKeyInput = container.querySelector<HTMLInputElement>("#orsApiKey");
  container.querySelector<HTMLInputElement>("#lookupAddresses")?.addEventListener("change", (event) => callbacks.onLookupAddressesChange?.((event.target as HTMLInputElement).checked));
  apiKeyInput?.addEventListener("change", () => callbacks.onApiKeyChange(apiKeyInput.value));

  const clearApiKeyBtn = container.querySelector<HTMLButtonElement>("#clearApiKey");
  clearApiKeyBtn?.addEventListener("click", callbacks.onClearApiKey);

  const overpassInput = container.querySelector<HTMLInputElement>("#overpassUrl");
  overpassInput?.addEventListener("change", () => callbacks.onOverpassUrlChange(overpassInput.value));

  container.querySelector<HTMLButtonElement>("#modeIdle")?.addEventListener("click", () => callbacks.onSetMode("idle"));
  container.querySelector<HTMLButtonElement>("#modeAddStation")?.addEventListener("click", () => callbacks.onSetMode("add_station"));
  container.querySelector<HTMLButtonElement>("#modeAddPoint")?.addEventListener("click", () => callbacks.onSetMode("add_point"));

  container.querySelector<HTMLButtonElement>("#modeAddPlacePoint")?.addEventListener("click", () => callbacks.onSetMode("add_place_point"));
  container.querySelector<HTMLButtonElement>("#modeMovePoint")?.addEventListener("click", () => callbacks.onSetMode("move_point"));
  container.querySelector<HTMLButtonElement>("#modeMovePlace")?.addEventListener("click", () => callbacks.onSetMode("move_place"));

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
      row.querySelector<HTMLButtonElement>("[data-point-trip-mode]")?.addEventListener("click", (event) => {
        event.stopPropagation();
        callbacks.onTogglePointTripMode(activeStation.id, pointId);
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
  container.querySelector<HTMLButtonElement>("#deleteAllTrips")?.addEventListener("click", callbacks.onDeleteAllTrips);
  for (const row of Array.from(container.querySelectorAll<HTMLElement>("tr[data-trip-id]"))) {
    const tripId = row.dataset.tripId;
    if (!tripId) continue;

    row.addEventListener("click", () => callbacks.onSelectTrip(tripId));
    row.querySelector<HTMLButtonElement>("[data-trip-delete]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      callbacks.onDeleteTrip(tripId);
    });
  }
  container.querySelector<HTMLButtonElement>("#resetAll")?.addEventListener("click", callbacks.onResetAll);

  restorePanelScroll(container, scrollState);
  if (model.scrollSelectedTripIntoView && model.selectedTripId) {
    const selectedRow = Array.from(container.querySelectorAll<HTMLElement>("tr[data-trip-id]")).find(
      (row) => row.dataset.tripId === model.selectedTripId
    );
    selectedRow?.scrollIntoView({ block: "nearest" });
  } else if (model.scrollSelectedIntoView && model.selectedPointId) {
    const selectedRow = Array.from(container.querySelectorAll<HTMLElement>("tr[data-point-id]")).find(
      (row) => row.dataset.pointId === model.selectedPointId
    );
    selectedRow?.scrollIntoView({ block: "nearest" });
  }
}
