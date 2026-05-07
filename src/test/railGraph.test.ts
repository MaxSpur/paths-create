import { describe, expect, it } from "vitest";

import { shortestPath, type RailGraph } from "../lib/railGraph";

function graph(edges: RailGraph["edges"]): RailGraph {
  const nodeIds = new Set<number>();
  for (const [from, neighbors] of edges) {
    nodeIds.add(from);
    for (const neighbor of neighbors) {
      nodeIds.add(neighbor.to);
    }
  }

  return {
    nodes: new Map(Array.from(nodeIds, (nodeId) => [nodeId, { lat: nodeId, lon: nodeId }])),
    edges
  };
}

describe("shortestPath", () => {
  it("returns the lowest-weight route instead of the fewest-hop route", () => {
    const railGraph = graph(
      new Map([
        [
          1,
          [
            { to: 2, weight: 2 },
            { to: 4, weight: 20 }
          ]
        ],
        [2, [{ to: 3, weight: 2 }]],
        [3, [{ to: 4, weight: 2 }]],
        [4, []]
      ])
    );

    expect(shortestPath(railGraph, 1, 4)).toEqual([1, 2, 3, 4]);
  });

  it("returns null when the destination cannot be reached", () => {
    const railGraph = graph(
      new Map([
        [1, [{ to: 2, weight: 1 }]],
        [2, []],
        [3, []]
      ])
    );

    expect(shortestPath(railGraph, 1, 3)).toBeNull();
  });
});
