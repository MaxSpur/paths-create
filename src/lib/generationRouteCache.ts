import type { LonLat } from "./types";
import type { TransitJourney } from "./transitTypes";

export interface CachedMetroSetup {
  railCoordinates: LonLat[];
  elevatedCoordinates?: LonLat[];
}

class BoundedLruCache<T> {
  private readonly values = new Map<string, T>();

  constructor(private readonly maxEntries: number) {}

  get(key: string): T | undefined {
    const value = this.values.get(key);
    if (value === undefined) return undefined;

    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }

  set(key: string, value: T): void {
    this.values.delete(key);
    this.values.set(key, value);

    while (this.values.size > this.maxEntries) {
      const oldestKey = this.values.keys().next().value;
      if (oldestKey === undefined) break;
      this.values.delete(oldestKey);
    }
  }

  clear(): void {
    this.values.clear();
  }
}

export class GenerationRouteCache {
  private readonly metroSetups = new BoundedLruCache<CachedMetroSetup>(16);

  private readonly walkingLegs = new BoundedLruCache<LonLat[]>(512);
  private readonly transitJourneys = new BoundedLruCache<TransitJourney>(16);

  getTransitJourney(key: string): TransitJourney | undefined {
    return this.transitJourneys.get(key);
  }

  setTransitJourney(key: string, journey: TransitJourney): void {
    this.transitJourneys.set(key, journey);
  }

  getMetroSetup(key: string): CachedMetroSetup | undefined {
    return this.metroSetups.get(key);
  }

  setMetroSetup(key: string, setup: CachedMetroSetup): void {
    this.metroSetups.set(key, setup);
  }

  getWalkingLeg(key: string): LonLat[] | undefined {
    return this.walkingLegs.get(key);
  }

  setWalkingLeg(key: string, coordinates: LonLat[]): void {
    this.walkingLegs.set(key, coordinates);
  }

  clear(): void {
    this.metroSetups.clear();
    this.walkingLegs.clear();
    this.transitJourneys.clear();
  }
}

export function createGenerationRouteCache(): GenerationRouteCache {
  return new GenerationRouteCache();
}
