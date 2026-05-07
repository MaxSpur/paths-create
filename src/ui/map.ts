import L from "leaflet";
import type { LocationSearchResult } from "../lib/geocode";
import type { GeneratedTrip, LatLon, LonLat, StationRecord } from "../lib/types";

export interface MapCallbacks {
  onMapClick: (point: LatLon) => void;
  onStationClick: (stationId: string) => void;
  onPointClick: (stationId: string, pointId: string) => void;
  onViewChange: (point: LatLon, zoom: number) => void;
  onLocationSearch: (query: string) => Promise<LocationSearchResult | null>;
}

export interface MapRenderModel {
  stations: StationRecord[];
  activeStationId: string | null;
  selectedPointId: string | null;
  selectedOriginStationId: string | null;
  selectedDestinationStationId: string | null;
  previewTrips: GeneratedTrip[];
}

export class MapView {
  private readonly map: L.Map;

  private readonly stationLayer: L.LayerGroup;

  private readonly pointLayer: L.LayerGroup;

  private readonly previewLayer: L.LayerGroup;

  private readonly circleLayer: L.LayerGroup;

  private readonly callbacks: MapCallbacks;

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

    L.DomEvent.disableClickPropagation(form);
    L.DomEvent.disableScrollPropagation(form);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const query = input?.value.trim() ?? "";
      if (!query || !button || !status || !input) {
        return;
      }

      button.disabled = true;
      input.disabled = true;
      status.textContent = "Searching...";

      void this.callbacks.onLocationSearch(query)
        .then((result) => {
          if (!result) {
            status.textContent = "No results.";
            return;
          }

          this.focusOnLocation(result);
          input.value = result.label;
          status.textContent = result.label;
        })
        .catch((error: unknown) => {
          status.textContent = error instanceof Error ? error.message : String(error);
        })
        .finally(() => {
          button.disabled = false;
          input.disabled = false;
          input.focus();
        });
    });

    container.append(form);
  }

  render(model: MapRenderModel): void {
    this.stationLayer.clearLayers();
    this.pointLayer.clearLayers();
    this.previewLayer.clearLayers();
    this.circleLayer.clearLayers();

    const stationById = new Map(model.stations.map((station) => [station.id, station]));

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

    const activeStation = model.activeStationId ? stationById.get(model.activeStationId) : undefined;
    if (activeStation) {
      for (const point of activeStation.walkPoints) {
        const isSelected = point.id === model.selectedPointId;
        const marker = L.circleMarker([point.lat, point.lon], {
          radius: isSelected ? 7 : 5,
          color: isSelected ? "#b45309" : "#f97316",
          fillColor: isSelected ? "#facc15" : "#fb923c",
          fillOpacity: 0.96,
          weight: isSelected ? 2.2 : 1.5,
          bubblingMouseEvents: false
        });
        marker.bindTooltip(point.label || point.id, { direction: "top" });
        marker.on("click", (event: L.LeafletMouseEvent) => {
          L.DomEvent.stop(event);
          this.callbacks.onPointClick(activeStation.id, point.id);
        });
        marker.addTo(this.pointLayer);
      }
    }

    for (const trip of model.previewTrips) {
      const toLatLng = (coords: LonLat[]) => coords.map((c) => L.latLng(c[1], c[0]));
      L.polyline(toLatLng(trip.walkInCoords), { color: "#2f855a", weight: 3.4, opacity: 0.8 }).addTo(this.previewLayer);
      L.polyline(toLatLng(trip.metroCoords), { color: "#1d4ed8", weight: 3.6, opacity: 0.84 }).addTo(this.previewLayer);
      L.polyline(toLatLng(trip.walkOutCoords), { color: "#b45309", weight: 3.4, opacity: 0.8 }).addTo(this.previewLayer);
    }
  }
}
