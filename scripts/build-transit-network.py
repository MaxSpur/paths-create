#!/usr/bin/env python3
"""Build a dated synthetic transit network from an IDFM GTFS ZIP (Python stdlib).

Usage: python3 scripts/build-transit-network.py INPUT.zip --retrieved YYYY-MM-DD
No network access. Scheduled times are deliberately omitted; boarding permissions,
directed stop order, shape variants and explicit transfers are retained.
"""

import argparse
import collections
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import re
import zipfile

DATASET_URL = "https://prim.iledefrance-mobilites.fr/fr/jeux-de-donnees/offre-horaires-tc-gtfs-idfm"
DOWNLOAD_URL = "https://eu.ftp.opendatasoft.com/stif/GTFS/IDFM-gtfs.zip"
MOBILITY_LICENSE = "https://cloud.fabmob.io/s/eYWWJBdM3fQiFNm"
ODBL_LICENSE = "https://opendatacommons.org/licenses/odbl/1-0/"
METERS_PER_DEGREE = 111_195.0


def records(archive, name):
    with archive.open(name + ".txt") as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))


def metric(point, cos_lat):
    return point[0] * METERS_PER_DEGREE * cos_lat, point[1] * METERS_PER_DEGREE


def projection(point, start, end):
    dx, dy = end[0] - start[0], end[1] - start[1]
    denominator = dx * dx + dy * dy
    t = max(0.0, min(1.0, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / denominator)) if denominator else 0.0
    projected = start[0] + t * dx, start[1] + t * dy
    return t, math.hypot(point[0] - projected[0], point[1] - projected[1])


def simplify(points, tolerance, cos_lat):
    """Iterative RDP, retaining both endpoints of each inter-stop section."""
    if len(points) < 3 or tolerance <= 0:
        return points
    xy = [metric(point, cos_lat) for point in points]
    keep = {0, len(points) - 1}
    pending = [(0, len(points) - 1)]
    while pending:
        first, last = pending.pop()
        maximum, index = tolerance, None
        for current in range(first + 1, last):
            _, distance = projection(xy[current], xy[first], xy[last])
            if distance > maximum:
                maximum, index = distance, current
        if index is not None:
            keep.add(index)
            pending.extend(((first, index), (index, last)))
    return [points[index] for index in sorted(keep)]


def align_shape(coordinates, stop_coordinates, max_distance, tolerance):
    if len(coordinates) < 2:
        return None
    cos_lat = math.cos(math.radians(sum(point[1] for point in stop_coordinates) / len(stop_coordinates)))
    xy = [metric(point, cos_lat) for point in coordinates]
    previous = -1.0
    positions = []
    for point in stop_coordinates:
        target = metric(point, cos_lat)
        best = None
        for index in range(max(0, int(previous)), len(coordinates) - 1):
            t, distance = projection(target, xy[index], xy[index + 1])
            position = index + t
            if position + 1e-8 < previous:
                continue
            if best is None or distance < best[0] - 1e-6:
                best = distance, position
        if best is None or best[0] > max_distance:
            return None
        previous = best[1]
        positions.append(previous)

    def at(position):
        index = min(int(position), len(coordinates) - 2)
        t = position - index
        return [coordinates[index][axis] + t * (coordinates[index + 1][axis] - coordinates[index][axis]) for axis in (0, 1)]

    output = [at(positions[0])]
    offsets = [0]
    for start, end in zip(positions, positions[1:]):
        if end <= start + 1e-8:
            # Distinct served stops must have an actual directed transit section.
            return None
        section = [at(start)]
        section.extend(coordinates[index] for index in range(int(start) + 1, math.ceil(end)))
        section.append(at(end))
        output.extend(simplify(section, tolerance, cos_lat)[1:])
        offsets.append(len(output) - 1)
    return [[round(value, 6) for value in point] for point in output], offsets


def build(args):
    statistics = collections.Counter()
    digest = hashlib.sha256()
    with args.input.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    with zipfile.ZipFile(args.input) as archive:
        agencies = {row["agency_id"]: row["agency_name"] for row in records(archive, "agency")}
        routes = sorted((row for row in records(archive, "routes")
                         if row["route_type"] in {"0", "1", "2", "3"}
                         and (args.include_ter or agencies.get(row["agency_id"], "").upper() != "TER")), key=lambda row: row["route_id"])
        line_indexes = {row["route_id"]: index for index, row in enumerate(routes)}
        lines = []
        for row in routes:
            name = row["route_short_name"] or row["route_long_name"]
            mode = {"0": "tram", "1": "metro", "3": "bus"}.get(row["route_type"], "rer" if name in "ABCDE" and len(name) == 1 else "train")
            color = row.get("route_color", "")
            lines.append({"id": row["route_id"], "name": name, "mode": mode, "color": "#" + (color if re.fullmatch(r"[0-9A-Fa-f]{6}", color) else "64748b")})
        trips = {row["trip_id"]: (line_indexes[row["route_id"]], row["shape_id"])
                 for row in records(archive, "trips") if row["route_id"] in line_indexes}
        print(f"Selected {len(lines)} lines / {len(trips)} trips; streaming stop_times…", flush=True)
        trip_stops = collections.defaultdict(list)
        for row in records(archive, "stop_times"):
            trip_id = row["trip_id"]
            if trip_id in trips:
                # On-demand pickup/dropoff (2/3) are not regular public boarding.
                trip_stops[trip_id].append((int(row["stop_sequence"]), row["stop_id"], row["pickup_type"] in {"", "0"}, row["drop_off_type"] in {"", "0"}))
        unique = set()
        for trip_id, entries in trip_stops.items():
            entries.sort()
            line, shape = trips[trip_id]
            unique.add((line, shape, tuple((entry[1], entry[2], entry[3]) for entry in entries)))
        del trip_stops
        statistics["selectedTrips"] = len(trips)
        statistics["distinctSourcePatterns"] = len(unique)
        wanted_shapes = {item[1] for item in unique}
        shapes = collections.defaultdict(list)
        for row in records(archive, "shapes"):
            if row["shape_id"] in wanted_shapes:
                shapes[row["shape_id"]].append((int(row["shape_pt_sequence"]), float(row["shape_pt_lon"]), float(row["shape_pt_lat"])))
        shape_coordinates = {}
        for shape, entries in shapes.items():
            entries.sort()
            coordinates = []
            for _, lon, lat in entries:
                if not coordinates or coordinates[-1] != [lon, lat]:
                    coordinates.append([lon, lat])
            shape_coordinates[shape] = coordinates
        all_stops = {row["stop_id"]: row for row in records(archive, "stops")}
        patterns_raw = []
        print(f"Aligning {len(unique)} patterns / {len(shapes)} source shapes…", flush=True)
        for line, shape, entries in sorted(unique):
            if not any(entry[1] for entry in entries[:-1]) or not any(entry[2] for entry in entries[1:]):
                statistics["rejectedNoRegularBoarding"] += 1
                continue
            if len(entries) < 2 or any(entry[0] not in all_stops for entry in entries):
                statistics["rejectedInvalidStops"] += 1
                continue
            if shape not in shape_coordinates:
                statistics["rejectedMissingShape"] += 1
                continue
            stop_coordinates = [[float(all_stops[entry[0]]["stop_lon"]), float(all_stops[entry[0]]["stop_lat"])] for entry in entries]
            aligned = align_shape(shape_coordinates[shape], stop_coordinates, args.max_stop_distance, args.simplify)
            if aligned is None:
                statistics["rejectedShapeAlignment"] += 1
                continue
            coordinates, offsets = aligned
            patterns_raw.append((line, entries, coordinates, offsets))
        statistics["selectedLines"] = len(lines)
        retained_lines = sorted({line for line, _, _, _ in patterns_raw})
        remap_lines = {line: index for index, line in enumerate(retained_lines)}
        lines = [lines[line] for line in retained_lines]
        patterns_raw = [(remap_lines[line], entries, coordinates, offsets)
                        for line, entries, coordinates, offsets in patterns_raw]
        line_indexes = {line["id"]: index for index, line in enumerate(lines)}
        retained_ids = sorted({entry[0] for _, entries, _, _ in patterns_raw for entry in entries})
        stop_indexes = {stop_id: index for index, stop_id in enumerate(retained_ids)}
        stops = []
        children = collections.defaultdict(list)
        for stop_id in retained_ids:
            row = all_stops[stop_id]
            stop = {"id": stop_id, "name": row["stop_name"], "lat": round(float(row["stop_lat"]), 6), "lon": round(float(row["stop_lon"]), 6)}
            if row["parent_station"]:
                stop["parent"] = row["parent_station"]
                children[row["parent_station"]].append(stop_indexes[stop_id])
            stops.append(stop)
        patterns = [{"line": line, "stops": [stop_indexes[entry[0]] for entry in entries], "coordinates": coordinates,
                     "offsets": offsets, "pickup": [entry[1] for entry in entries], "dropoff": [entry[2] for entry in entries]}
                    for line, entries, coordinates, offsets in patterns_raw]

        def endpoints(stop_id):
            return [stop_indexes[stop_id]] if stop_id in stop_indexes else children.get(stop_id, [])

        allowed, forbidden = set(), set()
        for row in records(archive, "transfers"):
            transfer_type = row["transfer_type"] or "0"
            if transfer_type not in {"0", "1", "2", "3"}:
                continue
            target = forbidden if transfer_type == "3" else allowed
            for first in endpoints(row["from_stop_id"]):
                for second in endpoints(row["to_stop_id"]):
                    if first != second:
                        target.add((first, second))
        transfers = sorted(allowed - forbidden)
        attribution_rows = [row for row in records(archive, "attributions") if not row["route_id"] or row["route_id"] in line_indexes]
        dates = []
        for row in records(archive, "calendar"):
            dates.extend((row["start_date"], row["end_date"]))
        dates.extend(row["date"] for row in records(archive, "calendar_dates"))
    statistics.update({"lines": len(lines), "stops": len(stops), "patterns": len(patterns), "transfers": len(transfers),
                       "sourceShapes": len(shapes), "coordinates": sum(len(pattern["coordinates"]) for pattern in patterns),
                       "prohibitedTransferPairs": len(forbidden)})
    source = {
        "url": DATASET_URL, "retrieved": args.retrieved, "license": "Licence Mobilité; shapes: ODbL-1.0",
        "attribution": "Transit data: Île-de-France Mobilités. Shape geometry: Île-de-France Mobilités / © OpenStreetMap contributors.",
        "downloadUrl": DOWNLOAD_URL, "sha256": digest.hexdigest(), "feedDateRange": [min(dates), max(dates)],
        "licenses": [{"component": "service-and-transfer-data", "name": "Licence Mobilité", "url": MOBILITY_LICENSE},
                     {"component": "shapes", "name": "ODbL-1.0", "url": ODBL_LICENSE}],
        "organizations": attribution_rows,
        "processing": {"builder": "scripts/build-transit-network.py", "version": 2, "routeTypes": [0, 1, 2, 3],
                       "excludedTER": not args.include_ter, "maxStopShapeDistanceMeters": args.max_stop_distance,
                       "simplificationMeters": args.simplify, "statistics": dict(statistics)},
        "limitations": ["Synthetic service connectivity only; schedules, travel times and operating-day restrictions omitted.",
                        "Shapes are automatically generated by IDFM using OpenStreetMap, not surveyed track geometry.",
                        "Transfers are explicit GTFS connections; internal walking geometry is not supplied by transfers.txt.",
                        "Patterns with missing geometry, nonmonotonic stop alignment or excessive stop-to-shape distance are excluded."]
    }
    network = {"schemaVersion": 1, "version": f"idfm-{args.retrieved}-{digest.hexdigest()[:12]}-v2", "source": source,
               "stops": stops, "lines": lines, "patterns": patterns, "transfers": transfers}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(network, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({**statistics, "outputBytes": args.output.stat().st_size}, indent=2), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--retrieved", required=True, help="Source download date, YYYY-MM-DD")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "public/data/idfm-transit.json")
    parser.add_argument("--max-stop-distance", type=float, default=400.0)
    parser.add_argument("--simplify", type=float, default=3.0)
    parser.add_argument("--include-ter", action="store_true")
    arguments = parser.parse_args()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", arguments.retrieved):
        parser.error("--retrieved must use YYYY-MM-DD")
    build(arguments)
