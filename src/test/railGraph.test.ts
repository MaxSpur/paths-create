import { describe, expect, it } from "vitest";

import { buildRailGraph, shortestPath, snapToNearestNode, type RailGraph } from "../lib/railGraph";

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

  it("reconstructs long paths without changing their order", () => {
    const nodeCount = 10_000;
    const edges = new Map<number, Array<{ to: number; weight: number }>>();
    for (let node = 1; node <= nodeCount; node += 1) {
      edges.set(node, node < nodeCount ? [{ to: node + 1, weight: 1 }] : []);
    }

    const path = shortestPath(graph(edges), 1, nodeCount);
    expect(path).toHaveLength(nodeCount);
    expect(path?.[0]).toBe(1);
    expect(path?.at(-1)).toBe(nodeCount);
  });

  it("uses the spatial index when snapping built graphs", () => {
    const railGraph = buildRailGraph({
      elements: [
        { type: "node", id: 1, lat: 48.85, lon: 2.35 },
        { type: "node", id: 2, lat: 48.851, lon: 2.351 },
        { type: "way", id: 10, nodes: [1, 2] }
      ]
    });

    expect(snapToNearestNode(railGraph, { lat: 48.8501, lon: 2.3501 }, 200)).toBe(1);
    expect(snapToNearestNode(railGraph, { lat: 49, lon: 2.5 }, 200)).toBeNull();
  });
});
