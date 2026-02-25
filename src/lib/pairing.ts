import type { PairingResult, WalkPoint } from "./types";
import { createSeededRandom, shuffleInPlace } from "./sampling";

function pairKey(originId: string, destinationId: string): string {
  return `${originId}::${destinationId}`;
}

export function generateRoundRobinPairs(
  originPool: WalkPoint[],
  destinationPool: WalkPoint[],
  tripCount: number,
  seed?: number
): PairingResult {
  if (originPool.length === 0 || destinationPool.length === 0 || tripCount <= 0) {
    return {
      pairs: [],
      uniquePairsUsed: 0,
      maxPairReuse: 0
    };
  }

  const random = createSeededRandom(seed);
  const pairs: PairingResult["pairs"] = [];
  const usage = new Map<string, number>();

  while (pairs.length < tripCount) {
    const origins = shuffleInPlace([...originPool], random);
    const destinations = shuffleInPlace([...destinationPool], random);

    for (let offset = 0; offset < destinations.length && pairs.length < tripCount; offset += 1) {
      for (let i = 0; i < origins.length && pairs.length < tripCount; i += 1) {
        const origin = origins[i];
        const destination = destinations[(i + offset) % destinations.length];
        const key = pairKey(origin.id, destination.id);
        usage.set(key, (usage.get(key) ?? 0) + 1);
        pairs.push({ origin, destination, pairKey: key });
      }
    }
  }

  let maxPairReuse = 0;
  for (const count of usage.values()) {
    if (count > maxPairReuse) {
      maxPairReuse = count;
    }
  }

  return {
    pairs,
    uniquePairsUsed: usage.size,
    maxPairReuse
  };
}
