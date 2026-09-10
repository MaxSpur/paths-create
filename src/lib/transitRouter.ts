import { haversineDistanceM, toLatLon, toLonLat } from "./geo";
import type { LatLon, LonLat } from "./types";
import type { TransitJourney, TransitLeg, TransitMode, TransitNetwork, TransitStop } from "./transitTypes";

export interface TransitRoutingOptions {
  maxTransfers?: number;
  maxAccessDistanceM?: number;
  /** Distance-equivalent preference for fewer boardings; this does not model time. */
  transferPenaltyM?: number;
  /** Explicit candidate costs support point-to-point routing with validated walking distances. */
  originStopCosts?: ReadonlyMap<number, number>;
  destinationStopCosts?: ReadonlyMap<number, number>;
  walkingWeight?: number;
  blockedTransferStops?: ReadonlySet<string>;
  /** Restrict the initial ride only; later transfers may use any service mode. */
  initialBoardingMode?: TransitMode;
}

interface Occurrence { pattern: number; index: number; stop: number; distance: number }
interface Graph {
  occurrences: Occurrence[];
  board: number[][];
  transfers: number[][];
  stopGroups: number[];
  geometries: Map<string, LonLat[]>;
  geometryPoints: number;
}
interface Step { kind: "ride" | "transfer" | "alight"; from: number; to: number; boarding?: boolean }
interface Label { node: number; boardings: number; cost: number; originGroup?: number; previous?: Label; step?: Step }

const graphs = new WeakMap<TransitNetwork, Graph>();

/** Networks are immutable: preprocessing is reused across queries on the same object. */
function graphFor(network: TransitNetwork): Graph {
  const cached = graphs.get(network);
  if (cached) return cached;
  const groups = new Map<string, number>();
  const stopGroups = network.stops.map((stop) => {
    const group = stop.parent ?? stop.id;
    if (!groups.has(group)) groups.set(group, groups.size);
    return groups.get(group)!;
  });
  const graph: Graph = {
    stopGroups, geometries: new Map(), geometryPoints: 0,
    occurrences: [],
    board: network.stops.map(() => []),
    transfers: network.stops.map(() => [])
  };
  network.patterns.forEach((pattern, patternIndex) => {
    const cumulative = [0];
    for (let i = 1; i < pattern.coordinates.length; i++) {
      cumulative.push(cumulative[i - 1] + haversineDistanceM(
        toLatLon(pattern.coordinates[i - 1]), toLatLon(pattern.coordinates[i])
      ));
    }
    pattern.stops.forEach((stop, index) => {
      const occurrence = graph.occurrences.length;
      graph.occurrences.push({
        pattern: patternIndex, index, stop,
        distance: index + 1 < pattern.stops.length
          ? cumulative[pattern.offsets[index + 1]] - cumulative[pattern.offsets[index]] : 0
      });
      if (index + 1 < pattern.stops.length && pattern.pickup?.[index] !== false) {
        graph.board[stop].push(occurrence);
      }
    });
  });
  for (const [from, to] of network.transfers) graph.transfers[from].push(to);
  graphs.set(network, graph);
  return graph;
}

class MinHeap {
  private values: Array<{ label: Label; order: number }> = [];
  private order = 0;
  private less(a: { label: Label; order: number }, b: { label: Label; order: number }): boolean {
    return a.label.cost < b.label.cost || (a.label.cost === b.label.cost && a.order < b.order);
  }
  push(label: Label): void {
    const value = { label, order: this.order++ };
    let i = this.values.length;
    this.values.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(value, this.values[parent])) break;
      this.values[i] = this.values[parent];
      i = parent;
    }
    this.values[i] = value;
  }
  pop(): Label | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (!first || !last) return undefined;
    if (this.values.length) {
      let i = 0;
      while (i * 2 + 1 < this.values.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.values.length && this.less(this.values[child + 1], this.values[child])) child++;
        if (!this.less(this.values[child], last)) break;
        this.values[i] = this.values[child];
        i = child;
      }
      this.values[i] = last;
    }
    return first.label;
  }
}

function nearbyStops(network: TransitNetwork, point: LatLon, radius: number): Map<number, number> {
  const distances = network.stops.map((stop) => haversineDistanceM(point, stop));
  let nearest = -1;
  for (let i = 0; i < distances.length; i++) {
    if (distances[i] <= radius && (nearest < 0 || distances[i] < distances[nearest])) nearest = i;
  }
  const result = new Map<number, number>();
  if (nearest < 0) return result;
  const group = network.stops[nearest].parent ?? network.stops[nearest].id;
  network.stops.forEach((stop, i) => {
    if ((stop.parent ?? stop.id) === group && distances[i] <= radius) result.set(i, distances[i]);
  });
  return result;
}

function atCoordinate(stop: TransitStop, coordinate: LonLat): TransitStop {
  return { ...stop, lon: coordinate[0], lat: coordinate[1] };
}

/** Exact coordinates and line identity preserve branch geometry and preview colors. */
function shareGeometry(graph: Graph, leg: TransitLeg): void {
  if (leg.kind !== "transit" || leg.coordinates.length > 50_000) return;
  const key = JSON.stringify([leg.line?.id, leg.coordinates]);
  const shared = graph.geometries.get(key);
  if (shared) {
    graph.geometries.delete(key);
    graph.geometries.set(key, shared);
    leg.coordinates = shared;
    return;
  }
  graph.geometries.set(key, leg.coordinates);
  graph.geometryPoints += leg.coordinates.length;
  while (graph.geometries.size > 128 || graph.geometryPoints > 50_000) {
    const oldest = graph.geometries.keys().next().value!;
    graph.geometryPoints -= graph.geometries.get(oldest)!.length;
    graph.geometries.delete(oldest);
  }
}

function reconstruct(network: TransitNetwork, graph: Graph, end: Label): TransitJourney {
  const steps: Step[] = [];
  for (let label: Label | undefined = end; label?.previous; label = label.previous) {
    if (label.step && label.step.kind !== "alight") steps.push(label.step);
  }
  steps.reverse();
  const legs: TransitLeg[] = [];
  let previousPattern = -1;
  for (const step of steps) {
    const last = legs.at(-1);
    if (step.kind === "transfer") {
      const from = network.stops[step.from];
      const to = network.stops[step.to];
      if (last?.kind === "transfer") {
        last.to = to;
        last.coordinates.push(toLonLat(to));
      } else {
        legs.push({ kind: "transfer", mode: "walking", from, to,
          coordinates: [toLonLat(from), toLonLat(to)], geometrySource: "station-connector" });
      }
      previousPattern = -1;
      continue;
    }
    const occurrence = graph.occurrences[step.from];
    const next = graph.occurrences[step.to];
    const pattern = network.patterns[occurrence.pattern];
    const coordinates = pattern.coordinates.slice(pattern.offsets[occurrence.index], pattern.offsets[next.index] + 1);
    const from = atCoordinate(network.stops[occurrence.stop], coordinates[0]);
    const to = atCoordinate(network.stops[next.stop], coordinates[coordinates.length - 1]);
    if (last?.kind === "transit" && previousPattern === occurrence.pattern && !step.boarding) {
      last.to = to;
      last.coordinates.push(...coordinates.slice(1));
    } else {
      legs.push({ kind: "transit", mode: network.lines[pattern.line].mode, from, to,
        line: network.lines[pattern.line], coordinates, geometrySource: "gtfs" });
    }
    previousPattern = occurrence.pattern;
  }
  // Platform centroids can be offset from the rail shape. Anchor all connectors to
  // the actual ridden geometry, including a shared platform on distinct shapes.
  const connected: TransitLeg[] = [];
  legs.forEach((leg, index) => {
    if (leg.kind === "transfer") {
      const before = legs[index - 1];
      const after = legs[index + 1];
      if (before) {
        leg.from = before.to;
        leg.coordinates[0] = before.coordinates[before.coordinates.length - 1];
      }
      if (after) {
        leg.to = after.from;
        leg.coordinates[leg.coordinates.length - 1] = after.coordinates[0];
      }
    } else {
      const before = connected.at(-1);
      if (before?.kind === "transit" && (before.to.lon !== leg.from.lon || before.to.lat !== leg.from.lat)) {
        connected.push({ kind: "transfer", mode: "walking", from: before.to, to: leg.from,
          coordinates: [toLonLat(before.to), toLonLat(leg.from)], geometrySource: "station-connector" });
      }
    }
    connected.push(leg);
  });
  connected.forEach((leg) => shareGeometry(graph, leg));
  return { legs: connected, from: connected[0].from, to: connected[connected.length - 1].to,
    transferCount: end.boardings - 1, networkVersion: network.version };
}

/** Route on directed services and declared station connections, never track crossings. */
export function findTransitJourney(
  network: TransitNetwork, origin: LatLon, destination: LatLon, options: TransitRoutingOptions = {}
): TransitJourney | null {
  const maxTransfers = options.maxTransfers ?? 3;
  const radius = options.maxAccessDistanceM ?? 350;
  const penalty = options.transferPenaltyM ?? 1500;
  if (!Number.isInteger(maxTransfers) || maxTransfers < 0 || !Number.isFinite(radius) || radius < 0 ||
      !Number.isFinite(penalty) || penalty < 0) throw new Error("Invalid transit routing options.");
  const starts = options.originStopCosts ?? nearbyStops(network, origin, radius);
  const ends = options.destinationStopCosts ?? nearbyStops(network, destination, radius);
  const automatic = options.originStopCosts !== undefined;
  const walkingWeight = options.walkingWeight ?? 1;
  if (!starts.size || !ends.size) return null;
  const startStop = network.stops[starts.keys().next().value!];
  const endStop = network.stops[ends.keys().next().value!];
  // A journey within one station needs walking, not a train loop back to it.
  if (!automatic && (startStop.parent ?? startStop.id) === (endStop.parent ?? endStop.id)) return null;
  const graph = graphFor(network);
  const stopCount = network.stops.length;
  const nodeCount = stopCount + graph.occurrences.length;
  // Retain distinct origins only for groups shared by both candidate sets. Without
  // that dimension an invalid station-return loop could suppress a valid journey
  // that starts at a different nearby station. Distant queries keep the small graph.
  const endGroups = new Set([...ends.keys()].map((stop) => graph.stopGroups[stop]));
  // Automatic egress must start at an alighting stop. A cheaper transfer arrival
  // at that same node cannot replace an eligible alighting label.
  const labelKey = (node: number, boardings: number, originGroup?: number, step?: Step): number =>
    (((originGroup ?? -1) + 1) * (maxTransfers + 2) * nodeCount + boardings * nodeCount + node) * 2 +
    (automatic && ends.has(node) && step?.kind === "alight" ? 1 : 0);
  const labels = new Map<number, Label>();
  const queue = new MinHeap();
  const add = (node: number, boardings: number, cost: number, previous?: Label, step?: Step,
    originGroup = previous?.originGroup): void => {
    const key = labelKey(node, boardings, originGroup, step);
    if (cost >= (labels.get(key)?.cost ?? Infinity)) return;
    const label: Label = { node, boardings, cost, originGroup, previous, step };
    labels.set(key, label);
    queue.push(label);
  };
  for (const [stop, distance] of starts) {
    const group = graph.stopGroups[stop];
    add(stop, 0, distance, undefined, undefined, automatic && endGroups.has(group) ? group : undefined);
  }
  let best: Label | undefined;
  let bestCost = Infinity;
  for (let current = queue.pop(); current; current = queue.pop()) {
    if (current.cost >= bestCost) break;
    if (labels.get(labelKey(current.node, current.boardings, current.originGroup, current.step)) !== current) continue;
    if (current.node < stopCount) {
      const stop = current.node;
      const egress = ends.get(stop);
      if (current.boardings > 0 && (!automatic || (current.step?.kind === "alight" && current.originGroup !== graph.stopGroups[stop])) && egress !== undefined && current.cost + egress < bestCost) {
        best = current;
        bestCost = current.cost + egress;
      }
      // Automatic access is routed directly to the boarding platform; pre-boarding
      // transfer chains would otherwise bypass the maximum access-walk distance.
      const transferTargets = (automatic && current.boardings === 0) ||
        options.blockedTransferStops?.has(network.stops[stop].id) ? [] : graph.transfers[stop];
      for (const to of transferTargets) {
        add(to, current.boardings, current.cost + walkingWeight * haversineDistanceM(network.stops[stop], network.stops[to]),
          current, { kind: "transfer", from: stop, to });
      }
      if (current.boardings <= maxTransfers) {
        for (const occurrence of graph.board[stop]) {
          if (current.boardings === 0 && options.initialBoardingMode &&
              network.lines[network.patterns[graph.occurrences[occurrence].pattern].line].mode !== options.initialBoardingMode) continue;
          add(stopCount + occurrence + 1, current.boardings + 1,
            current.cost + graph.occurrences[occurrence].distance + (current.boardings ? penalty : 0),
            current, { kind: "ride", from: occurrence, to: occurrence + 1, boarding: true });
        }
      }
    } else {
      const occurrenceIndex = current.node - stopCount;
      const occurrence = graph.occurrences[occurrenceIndex];
      const pattern = network.patterns[occurrence.pattern];
      if (pattern.dropoff?.[occurrence.index] !== false) {
        add(occurrence.stop, current.boardings, current.cost, current,
          { kind: "alight", from: occurrenceIndex, to: occurrence.stop });
      }
      if (occurrence.index + 1 < pattern.stops.length) {
        add(current.node + 1, current.boardings, current.cost + occurrence.distance, current,
          { kind: "ride", from: occurrenceIndex, to: occurrenceIndex + 1 });
      }
    }
  }
  return best ? reconstruct(network, graph, best) : null;
}
