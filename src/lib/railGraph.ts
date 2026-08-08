import { haversineDistanceM } from "./geo";
import type { LatLon, LonLat, OverpassResponse } from "./types";

export interface RailGraph {
  nodes: Map<number, LatLon>;
  edges: Map<number, Array<{ to: number; weight: number }>>;
  spatialIndex?: Map<string, number[]>;
  spatialCellSizeDeg?: number;
}

const SPATIAL_CELL_SIZE_DEG = 0.01;
const METERS_PER_LATITUDE_DEGREE = 111_320;

function spatialCellKey(lat: number, lon: number, cellSizeDeg: number): string {
  return `${Math.floor((lat + 90) / cellSizeDeg)}:${Math.floor((lon + 180) / cellSizeDeg)}`;
}

function buildSpatialIndex(nodes: Map<number, LatLon>): Map<string, number[]> {
  const index = new Map<string, number[]>();
  for (const [nodeId, point] of nodes) {
    const key = spatialCellKey(point.lat, point.lon, SPATIAL_CELL_SIZE_DEG);
    const cell = index.get(key);
    if (cell) {
      cell.push(nodeId);
    } else {
      index.set(key, [nodeId]);
    }
  }
  return index;
}

class MinDistanceQueue {
  private readonly items: Array<{ node: number; distance: number }> = [];

  get size(): number {
    return this.items.length;
  }

  push(node: number, distance: number): void {
    this.items.push({ node, distance });
    this.bubbleUp(this.items.length - 1);
  }

  pop(): { node: number; distance: number } | undefined {
    const min = this.items[0];
    const last = this.items.pop();
    if (!last || this.items.length === 0) {
      return min;
    }

    this.items[0] = last;
    this.sinkDown(0);
    return min;
  }

  private bubbleUp(index: number): void {
    let current = index;
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2);
      if (this.items[parent].distance <= this.items[current].distance) {
        break;
      }
      [this.items[parent], this.items[current]] = [this.items[current], this.items[parent]];
      current = parent;
    }
  }

  private sinkDown(index: number): void {
    let current = index;

    while (true) {
      const left = current * 2 + 1;
      const right = left + 1;
      let smallest = current;

      if (left < this.items.length && this.items[left].distance < this.items[smallest].distance) {
        smallest = left;
      }
      if (right < this.items.length && this.items[right].distance < this.items[smallest].distance) {
        smallest = right;
      }
      if (smallest === current) {
        break;
      }

      [this.items[current], this.items[smallest]] = [this.items[smallest], this.items[current]];
      current = smallest;
    }
  }
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

  return {
    nodes,
    edges,
    spatialIndex: buildSpatialIndex(nodes),
    spatialCellSizeDeg: SPATIAL_CELL_SIZE_DEG
  };
}

export function snapToNearestNode(
  graph: RailGraph,
  point: LatLon,
  maxDistanceM = 200
): number | null {
  let bestNode: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let candidates: Iterable<[number, LatLon]> = graph.nodes;

  if (graph.spatialIndex && graph.spatialCellSizeDeg) {
    const latitudeRadius = maxDistanceM / METERS_PER_LATITUDE_DEGREE;
    const longitudeScale = Math.max(0.05, Math.cos((point.lat * Math.PI) / 180));
    const longitudeRadius = maxDistanceM / (METERS_PER_LATITUDE_DEGREE * longitudeScale);
    const minLatCell = Math.floor((point.lat - latitudeRadius + 90) / graph.spatialCellSizeDeg);
    const maxLatCell = Math.floor((point.lat + latitudeRadius + 90) / graph.spatialCellSizeDeg);
    const minLonCell = Math.floor((point.lon - longitudeRadius + 180) / graph.spatialCellSizeDeg);
    const maxLonCell = Math.floor((point.lon + longitudeRadius + 180) / graph.spatialCellSizeDeg);
    const candidateNodes: Array<[number, LatLon]> = [];

    for (let latCell = minLatCell; latCell <= maxLatCell; latCell += 1) {
      for (let lonCell = minLonCell; lonCell <= maxLonCell; lonCell += 1) {
        const nodeIds = graph.spatialIndex.get(`${latCell}:${lonCell}`) ?? [];
        for (const nodeId of nodeIds) {
          const nodePoint = graph.nodes.get(nodeId);
          if (nodePoint) candidateNodes.push([nodeId, nodePoint]);
        }
      }
    }

    candidates = candidateNodes;
  }

  for (const [nodeId, nodePoint] of candidates) {
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
  if (!graph.nodes.has(startNode) || !graph.nodes.has(endNode)) {
    return null;
  }

  const distances = new Map<number, number>();
  const previous = new Map<number, number | null>();
  const visited = new Set<number>();
  const queue = new MinDistanceQueue();

  distances.set(startNode, 0);
  previous.set(startNode, null);
  queue.push(startNode, 0);

  while (queue.size > 0) {
    const entry = queue.pop();
    if (!entry || visited.has(entry.node)) {
      continue;
    }

    const current = entry.node;
    const currentDistance = distances.get(current) ?? Number.POSITIVE_INFINITY;
    if (entry.distance > currentDistance || currentDistance === Number.POSITIVE_INFINITY) {
      continue;
    }

    visited.add(current);
    if (current === endNode) {
      break;
    }

    const neighbors = graph.edges.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (visited.has(neighbor.to)) continue;
      const alt = currentDistance + neighbor.weight;
      if (alt < (distances.get(neighbor.to) ?? Number.POSITIVE_INFINITY)) {
        distances.set(neighbor.to, alt);
        previous.set(neighbor.to, current);
        queue.push(neighbor.to, alt);
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
    path.push(current);
    current = previous.get(current) ?? null;
  }

  path.reverse();

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
