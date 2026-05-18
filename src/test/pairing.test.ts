import { describe, expect, it } from "vitest";
import { generateRoundRobinPairs } from "../lib/pairing";

const originPool = [
  { id: "o1", lat: 0, lon: 0 },
  { id: "o2", lat: 0, lon: 0 }
];

const destinationPool = [
  { id: "d1", lat: 0, lon: 0 },
  { id: "d2", lat: 0, lon: 0 },
  { id: "d3", lat: 0, lon: 0 }
];

describe("generateRoundRobinPairs", () => {
  it("produces requested count", () => {
    const result = generateRoundRobinPairs(originPool, destinationPool, 5, 42);
    expect(result.pairs).toHaveLength(5);
  });

  it("avoids pair repeats before full combination exhaustion", () => {
    const comboCount = originPool.length * destinationPool.length;
    const result = generateRoundRobinPairs(originPool, destinationPool, comboCount, 42);
    const unique = new Set(result.pairs.map((pair) => pair.pairKey));
    expect(unique.size).toBe(comboCount);
    expect(result.maxPairReuse).toBe(1);
  });

  it("is deterministic for a fixed seed", () => {
    const first = generateRoundRobinPairs(originPool, destinationPool, 8, 99).pairs.map((p) => p.pairKey);
    const second = generateRoundRobinPairs(originPool, destinationPool, 8, 99).pairs.map((p) => p.pairKey);
    expect(second).toEqual(first);
  });

  it("stops at available unique pairs instead of reusing pairs", () => {
    const comboCount = originPool.length * destinationPool.length;
    const result = generateRoundRobinPairs(originPool, destinationPool, comboCount + 5, 42);
    expect(result.pairs).toHaveLength(comboCount);
    expect(result.maxPairReuse).toBe(1);
  });

  it("skips excluded pair keys", () => {
    const result = generateRoundRobinPairs(originPool, destinationPool, 6, {
      seed: 42,
      excludedPairKeys: ["o1::d1", "o2::d2"]
    });

    expect(result.pairs.map((pair) => pair.pairKey)).not.toContain("o1::d1");
    expect(result.pairs.map((pair) => pair.pairKey)).not.toContain("o2::d2");
    expect(result.pairs).toHaveLength(4);
  });
});
