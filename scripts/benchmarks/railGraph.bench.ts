// @vitest-environment node

import { bench, describe } from "vitest";

import { buildRailGraph, shortestPath, snapToNearestNode } from "../../src/lib/railGraph";
import type { OverpassResponse } from "../../src/lib/types";

const GRID_SIZE = 200;
const START_LAT = 48.82;
const START_LON = 2.36;
const STEP = 0.0005;

function createRailGrid(): OverpassResponse {
  const elements: OverpassResponse["elements"] = [];

  for (let row = 0; row < GRID_SIZE; row += 1) {
    const rowNodes: number[] = [];
    for (let column = 0; column < GRID_SIZE; column += 1) {
      const id = row * GRID_SIZE + column + 1;
      rowNodes.push(id);
      elements.push({
        type: "node",
        id,
        lat: START_LAT + row * STEP,
        lon: START_LON + column * STEP
      });
    }
    elements.push({ type: "way", id: 1_000_000 + row, nodes: rowNodes });
  }

  return { elements };
}

const graph = buildRailGraph(createRailGrid());
const firstRowStart = 1;
const firstRowEnd = GRID_SIZE;

describe("rail graph (40,000 nodes)", () => {
  bench("snap two stations", () => {
    snapToNearestNode(graph, { lat: START_LAT, lon: START_LON }, 500);
    snapToNearestNode(
      graph,
      { lat: START_LAT, lon: START_LON + (GRID_SIZE - 1) * STEP },
      500
    );
  });

  bench("shortest path across one connected row", () => {
    shortestPath(graph, firstRowStart, firstRowEnd);
  });
});
