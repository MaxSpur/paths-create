import L from "leaflet";
import type { LocationSearchBounds, LocationSearchResult } from "../lib/geocode";
import type { GeneratedTrip, LatLon, LonLat, StationRecord } from "../lib/types";
import { rankLocationSearchResults, type RankedLocationSearchResult } from "./locationSearch";
import { collectPreviewSegments, type PreviewSegment } from "./previewSegments";

export interface MapCallbacks {
  onTripClick: (tripId: string) => void;
  onMapClick: (point: LatLon) => void;
  onStationClick: (stationId: string) => void;
  onPointClick: (stationId: string, pointId: string) => void;
  onViewChange: (point: LatLon, zoom: number) => void;
  onLocationSearch: (query: string, bounds: LocationSearchBounds) => Promise<LocationSearchResult[]>;
}

export interface MapRenderModel {
  stations: StationRecord[];
  activeStationId: string | null;
  selectedPointId: string | null;
  selectedTripId: string | null;
  selectedOriginStationId: string | null;
  selectedDestinationStationId: string | null;
  previewTrips: GeneratedTrip[];
}

function pointMarkerColors(point: { tripMode?: "metro" | "driving" }, isSelected: boolean): {
  color: string;
  fillColor: string;
} {
  const isDriving = point.tripMode === "driving";
  if (isDriving) {
    return {
      color: isSelected ? "#581c87" : "#7c3aed",
      fillColor: isSelected ? "#c084fc" : "#a78bfa"
    };
  }

  return {
    color: isSelected ? "#b45309" : "#f97316",
    fillColor: isSelected ? "#facc15" : "#fb923c"
  };
}

function tripCoordinates(trip: GeneratedTrip): LonLat[] {
  return trip.routeMode === "driving"
    ? trip.drivingCoords
    : [...trip.walkInCoords, ...(trip.transitJourney ? trip.transitJourney.legs.flatMap((leg) => leg.coordinates) : trip.metroCoords), ...trip.walkOutCoords];
}

function stationRenderKey(model: MapRenderModel): string {
  return JSON.stringify([
    model.activeStationId,
    model.selectedOriginStationId,
    model.selectedDestinationStationId,
    model.stations.map((station) => [
      station.id,
      station.name,
      station.lat,
      station.lon,
      station.radiusM
    ])
  ]);
}

function pointRenderKey(model: MapRenderModel, activeStation?: StationRecord): string {
  return JSON.stringify([
    model.activeStationId,
    model.selectedPointId,
    activeStation?.walkPoints.map((point) => [
      point.id,
      point.lat,
      point.lon,
      point.label,
      point.tripMode
    ]) ?? []
  ]);
}

export class MapView {
  private readonly map: L.Map;

  private readonly stationLayer: L.LayerGroup;

  private readonly pointLayer: L.LayerGroup;

  private readonly previewLayer: L.LayerGroup;

  private readonly circleLayer: L.LayerGroup;

  private readonly callbacks: MapCallbacks;

  private lastStationRenderKey = "";

  private lastPointRenderKey = "";

  private lastPreviewTrips: GeneratedTrip[] | null = null;

  private lastSelectedTripId: string | null = null;

  constructor(container: HTMLElement, initialCenter: LatLon, initialZoom: number, callbacks: MapCallbacks) {
    this.callbacks = callbacks;
    this.map = L.map(container).setView([initialCenter.lat, initialCenter.lon], initialZoom);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(this.map);

    this.previewLayer = L.layerGroup().addTo(this.map);
    this.circleLayer = L.layerGroup().addTo(this.map);
    this.stationLayer = L.layerGroup().addTo(this.map);
    this.pointLayer = L.layerGroup().addTo(this.map);

    this.map.on("click", (event: L.LeafletMouseEvent) => {
      this.callbacks.onMapClick({ lat: event.latlng.lat, lon: event.latlng.lng });
    });

    this.map.on("moveend", () => {
      const center = this.map.getCenter();
      this.callbacks.onViewChange({ lat: center.lat, lon: center.lng }, this.map.getZoom());
    });

    this.addLocationSearchControl(container);
  }

  getCenter(): LatLon {
    const center = this.map.getCenter();
    return { lat: center.lat, lon: center.lng };
  }

  private getSearchBounds(): LocationSearchBounds {
    const bounds = this.map.getBounds();
    return {
      south: bounds.getSouth(),
      west: bounds.getWest(),
      north: bounds.getNorth(),
      east: bounds.getEast()
    };
  }

  focusOnPoint(point: LatLon): void {
    this.map.panTo([point.lat, point.lon], { animate: true, duration: 0.35 });
  }

  focusOnStation(station: StationRecord): void {
    const bounds = L.latLng(station.lat, station.lon).toBounds(Math.max(station.radiusM * 2, 10));
    this.map.invalidateSize();
    this.map.fitBounds(bounds.pad(0.35), {
      animate: true,
      duration: 0.45,
      maxZoom: 18,
      padding: [28, 28]
    });
  }

  focusOnTrip(trip: GeneratedTrip): void {
    const coords = tripCoordinates(trip);
    if (coords.length === 0) {
      return;
    }

    this.map.invalidateSize();
    if (coords.length === 1) {
      this.map.setView([coords[0][1], coords[0][0]], Math.max(this.map.getZoom(), 16), {
        animate: true,
        duration: 0.35
      });
      return;
    }

    const bounds = L.latLngBounds(coords.map((coord) => [coord[1], coord[0]]));
    this.map.fitBounds(bounds.pad(0.16), {
      animate: true,
      duration: 0.45,
      padding: [34, 34]
    });
  }

  private focusOnLocation(result: LocationSearchResult): void {
    const bbox = result.boundingBox;
    if (bbox && bbox.south !== bbox.north && bbox.west !== bbox.east) {
      this.map.fitBounds(
        L.latLngBounds(
          [bbox.south, bbox.west],
          [bbox.north, bbox.east]
        ).pad(0.18),
        {
          animate: true,
          duration: 0.45,
          maxZoom: 16,
          padding: [36, 36]
        }
      );
      return;
    }

    this.map.setView([result.lat, result.lon], Math.max(this.map.getZoom(), 14), {
      animate: true,
      duration: 0.45
    });
  }

  private addLocationSearchControl(container: HTMLElement): void {
    const form = document.createElement("form");
    form.className = "map-location-search";
    form.setAttribute("role", "search");
    form.innerHTML = `
      <label class="sr-only" for="mapLocationSearch">Search location</label>
      <div class="map-location-search-row">
        <input id="mapLocationSearch" type="search" placeholder="Search location" autocomplete="off" />
        <button type="submit">Go</button>
      </div>
      <div class="map-location-search-status" aria-live="polite"></div>
    `;

    const input = form.querySelector<HTMLInputElement>("#mapLocationSearch");
    const button = form.querySelector<HTMLButtonElement>("button");
    const status = form.querySelector<HTMLElement>(".map-location-search-status");
    const resultsList = document.createElement("div");
    resultsList.className = "map-location-search-results";
    resultsList.id = "mapLocationSearchResults";
    resultsList.setAttribute("role", "region");
    resultsList.setAttribute("aria-label", "Location search results");
    resultsList.hidden = true;
    form.append(resultsList);

    input?.setAttribute("aria-controls", resultsList.id);
    input?.setAttribute("aria-expanded", "false");
    let requestSequence = 0;

    L.DomEvent.disableClickPropagation(form);
    L.DomEvent.disableScrollPropagation(form);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const query = input?.value.trim() ?? "";
      if (!button || !status || !input) {
        return;
      }

      if (query.length < 3) {
        status.textContent = "Enter at least 3 characters.";
        this.renderLocationSearchResults(resultsList, []);
        return;
      }

      button.disabled = true;
      status.textContent = "Searching...";
      this.renderLocationSearchResults(resultsList, []);
      const searchBounds = this.getSearchBounds();
      const requestId = ++requestSequence;

      void this.callbacks.onLocationSearch(query, searchBounds)
        .then((results) => {
          if (requestId !== requestSequence) return;
          if (results.length === 0) {
            status.textContent = "No results.";
            return;
          }

          const rankedResults = rankLocationSearchResults(results, searchBounds).slice(0, 6);
          this.renderLocationSearchResults(resultsList, rankedResults);
          status.textContent = `${rankedResults.length} result${rankedResults.length === 1 ? "" : "s"}.`;
        })
        .catch((error: unknown) => {
          if (requestId !== requestSequence) return;
          status.textContent = error instanceof Error ? error.message : String(error);
        })
        .finally(() => {
          if (requestId !== requestSequence) return;
          button.disabled = false;
        });
    });

    input?.addEventListener("input", () => {
      requestSequence += 1;
      if (button) button.disabled = false;
      if (status) status.textContent = "";
      this.renderLocationSearchResults(resultsList, []);
    });

    input?.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      requestSequence += 1;
      if (button) button.disabled = false;
      if (status) status.textContent = "";
      this.renderLocationSearchResults(resultsList, []);
    });

    container.append(form);
  }

  private renderLocationSearchResults(
    resultsList: HTMLElement,
    rankedResults: RankedLocationSearchResult[]
  ): void {
    resultsList.replaceChildren();
    resultsList.hidden = rankedResults.length === 0;
    resultsList
      .closest("form")
      ?.querySelector<HTMLInputElement>("#mapLocationSearch")
      ?.setAttribute("aria-expanded", String(rankedResults.length > 0));

    for (const item of rankedResults) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "map-location-search-result";

      const title = document.createElement("span");
      title.className = "map-location-search-result-title";
      title.textContent = item.result.label;

      const bucket = document.createElement("span");
      bucket.className = `map-location-search-result-bucket ${item.bucket}`;
      bucket.textContent = item.bucketLabel;

      button.append(title, bucket);
      button.addEventListener("click", () => {
        this.focusOnLocation(item.result);
        const input = resultsList
          .closest("form")
          ?.querySelector<HTMLInputElement>("#mapLocationSearch");
        const status = resultsList
          .closest("form")
          ?.querySelector<HTMLElement>(".map-location-search-status");

        if (input) {
          input.value = item.result.label;
          input.focus();
        }
        if (status) {
          status.textContent = item.result.label;
        }
        this.renderLocationSearchResults(resultsList, []);
      });

      resultsList.append(button);
    }
  }

  render(model: MapRenderModel): void {
    const stationById = new Map(model.stations.map((station) => [station.id, station]));
    const activeStation = model.activeStationId ? stationById.get(model.activeStationId) : undefined;
    const nextStationRenderKey = stationRenderKey(model);

    if (nextStationRenderKey !== this.lastStationRenderKey) {
      this.lastStationRenderKey = nextStationRenderKey;
      this.stationLayer.clearLayers();
      this.circleLayer.clearLayers();

      for (const station of model.stations) {
        const isOrigin = station.id === model.selectedOriginStationId;
        const isDestination = station.id === model.selectedDestinationStationId;
        const isActive = station.id === model.activeStationId;

        const color = isOrigin && isDestination ? "#7c3aed" : isOrigin ? "#1d9d53" : isDestination ? "#c92a2a" : "#2563eb";

        const marker = L.circleMarker([station.lat, station.lon], {
          radius: isActive ? 9 : 7,
          color,
          fillColor: color,
          fillOpacity: isActive ? 0.95 : 0.85,
          weight: 2,
          bubblingMouseEvents: false
        });
        marker.bindTooltip(station.name, { direction: "top" });
        marker.on("click", (event: L.LeafletMouseEvent) => {
          L.DomEvent.stop(event);
          this.callbacks.onStationClick(station.id);
        });
        marker.addTo(this.stationLayer);

        if (isActive || isOrigin || isDestination) {
          L.circle([station.lat, station.lon], {
            radius: station.radiusM,
            color,
            fillColor: color,
            fillOpacity: isActive ? 0.14 : 0.09,
            weight: isActive ? 1.8 : 1.2,
            interactive: false
          }).addTo(this.circleLayer);
        }
      }
    }

    const nextPointRenderKey = pointRenderKey(model, activeStation);
    if (nextPointRenderKey !== this.lastPointRenderKey) {
      this.lastPointRenderKey = nextPointRenderKey;
      this.pointLayer.clearLayers();

      if (activeStation) {
        for (const point of activeStation.walkPoints) {
          const isSelected = point.id === model.selectedPointId;
          const colors = pointMarkerColors(point, isSelected);
          const marker = L.circleMarker([point.lat, point.lon], {
            radius: isSelected ? 7 : 5,
            color: colors.color,
            fillColor: colors.fillColor,
            fillOpacity: 0.96,
            weight: isSelected ? 2.2 : 1.5,
            bubblingMouseEvents: false
          });
          marker.bindTooltip(`${point.tripMode === "driving" ? "Driving" : "Transit"}: ${point.label || point.id}`, { direction: "top" });
          marker.on("click", (event: L.LeafletMouseEvent) => {
            L.DomEvent.stop(event);
            this.callbacks.onPointClick(activeStation.id, point.id);
          });
          marker.addTo(this.pointLayer);
        }
      }
    }

    if (
      model.previewTrips !== this.lastPreviewTrips ||
      model.selectedTripId !== this.lastSelectedTripId
    ) {
      this.lastPreviewTrips = model.previewTrips;
      this.lastSelectedTripId = model.selectedTripId;
      this.previewLayer.clearLayers();

      for (const segment of collectPreviewSegments(model.previewTrips, model.selectedTripId)) {
        this.renderPreviewSegment(segment, Boolean(model.selectedTripId));
      }
    }
  }

  private renderPreviewSegment(segment: PreviewSegment, hasSelectedTrip: boolean): void {
    const styles: Record<PreviewSegment["role"], { color: string; weight: number }> = {
      "walk-in": { color: "#2f855a", weight: 3.4 },
      metro: { color: "#1d4ed8", weight: 3.6 },
      transit: { color: "#1d4ed8", weight: 3.6 },
      transfer: { color: "#64748b", weight: 3.4 },
      "walk-out": { color: "#b45309", weight: 3.4 },
      driving: { color: "#7c3aed", weight: 3.7 }
    };
    const style = styles[segment.role];
    const baseOpacity = hasSelectedTrip ? 0.22 : 0.82;

    const line = L.polyline(segment.coords.map((coord) => L.latLng(coord[1], coord[0])), {
      color: segment.color && /^#?[0-9a-f]{6}$/i.test(segment.color)
        ? `#${segment.color.replace(/^#/, "")}` : style.color,
      bubblingMouseEvents: false,
      dashArray: segment.dashed ? "6 5" : undefined,
      weight: style.weight + (segment.highlighted ? 2.1 : 0),
      opacity: segment.highlighted
        ? segment.role === "metro" ? 0.98 : 0.96
        : segment.role === "metro" ? Math.min(0.84, baseOpacity) : baseOpacity
    }).addTo(this.previewLayer);
    line.on("click", (event: L.LeafletMouseEvent) => {
      L.DomEvent.stop(event);
      this.callbacks.onTripClick(segment.tripId);
    });
  }
}
