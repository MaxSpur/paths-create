import { haversineDistanceM } from "./geo";
import type { LatLon, LonLat, OverpassResponse } from "./types";

export interface RailGraph {
  nodes: Map<number, LatLon>;
  edges: Map<number, Array<{ to: number; weight: number }>>;
}

function addEdge(
  edges: Map<number, Array<{ to: number; weight: number }>>,
  from: number,
  to: number,
  weight: number
): void {
  if (!edges.has(from)) {
    edges.set(from, []);
  }
  edges.get(from)?.push({ to, weight });
}

export function buildRailGraph(overpassData: OverpassResponse): RailGraph {
  const nodes = new Map<number, LatLon>();
  const edges = new Map<number, Array<{ to: number; weight: number }>>();

  for (const element of overpassData.elements) {
    if (element.type === "node") {
      nodes.set(element.id, { lat: element.lat, lon: element.lon });
    }
  }

  for (const element of overpassData.elements) {
    if (element.type !== "way") continue;
    if (!element.nodes || element.nodes.length < 2) continue;

    for (let i = 0; i < element.nodes.length - 1; i += 1) {
      const aId = element.nodes[i];
      const bId = element.nodes[i + 1];
      const a = nodes.get(aId);
      const b = nodes.get(bId);
      if (!a || !b) continue;

      const distance = haversineDistanceM(a, b);
      addEdge(edges, aId, bId, distance);
      addEdge(edges, bId, aId, distance);
    }
  }

  return { nodes, edges };
}

export function snapToNearestNode(
  graph: RailGraph,
  point: LatLon,
  maxDistanceM = 200
): number | null {
  let bestNode: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const [nodeId, nodePoint] of graph.nodes.entries()) {
    const d = haversineDistanceM(point, nodePoint);
    if (d < bestDistance) {
      bestDistance = d;
      bestNode = nodeId;
    }
  }

  if (bestDistance > maxDistanceM) {
    return null;
  }

  return bestNode;
}

export function shortestPath(graph: RailGraph, startNode: number, endNode: number): number[] | null {
  const distances = new Map<number, number>();
  const previous = new Map<number, number | null>();
  const unvisited = new Set<number>(graph.nodes.keys());

  for (const node of unvisited) {
    distances.set(node, Number.POSITIVE_INFINITY);
    previous.set(node, null);
  }
  distances.set(startNode, 0);

  while (unvisited.size > 0) {
    let current: number | null = null;
    let currentDistance = Number.POSITIVE_INFINITY;

    for (const node of unvisited) {
      const d = distances.get(node) ?? Number.POSITIVE_INFINITY;
      if (d < currentDistance) {
        currentDistance = d;
        current = node;
      }
    }

    if (current === null || currentDistance === Number.POSITIVE_INFINITY) {
      break;
    }

    unvisited.delete(current);
    if (current === endNode) {
      break;
    }

    const neighbors = graph.edges.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (!unvisited.has(neighbor.to)) continue;
      const alt = currentDistance + neighbor.weight;
      if (alt < (distances.get(neighbor.to) ?? Number.POSITIVE_INFINITY)) {
        distances.set(neighbor.to, alt);
        previous.set(neighbor.to, current);
      }
    }
  }

  const endDistance = distances.get(endNode) ?? Number.POSITIVE_INFINITY;
  if (!Number.isFinite(endDistance) || endDistance === Number.POSITIVE_INFINITY) {
    return null;
  }

  const path: number[] = [];
  let current: number | null = endNode;
  while (current !== null) {
    path.unshift(current);
    current = previous.get(current) ?? null;
  }

  if (path[0] !== startNode) {
    return null;
  }

  return path;
}

export function nodePathToCoordinates(graph: RailGraph, path: number[]): LonLat[] {
  const coordinates: LonLat[] = [];
  for (const nodeId of path) {
    const node = graph.nodes.get(nodeId);
    if (!node) continue;
    coordinates.push([node.lon, node.lat]);
  }
  return coordinates;
}
