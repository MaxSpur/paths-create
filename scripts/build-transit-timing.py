#!/usr/bin/env python3
"""Derive compact time-band estimates for an existing network from a pinned GTFS ZIP.

Streaming stop_times keeps raw timetable data out of the browser. Statistics are
observations of scheduled service, not historic routing or reconstructed journeys.
"""
import argparse
import collections
import csv
import datetime as dt
import hashlib
import gzip
import io
import json
import statistics
import zipfile
from pathlib import Path


def records(z, name):
    with z.open(name + '.txt') as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding='utf-8-sig', newline=''))


def seconds(s):
    try:
        h, m, sec = map(int, s.split(':'))
        return h * 3600 + m * 60 + sec if h >= 0 and 0 <= m < 60 and 0 <= sec < 60 else None
    except (ValueError, AttributeError):
        return None


def band(second):
    h = second / 3600 % 24
    return 'night' if h < 7 or h >= 22 else 'am' if h < 10 else 'day' if h < 16 else 'pm' if h < 20 else 'evening'


def day_kind(date):
    return 'weekday' if date.weekday() < 5 else 'saturday' if date.weekday() == 5 else 'sunday'


class Sample:
    """Bounded deterministic reservoir; count remains the full observation count."""
    def __init__(self):
        self.values = []
        self.n = 0

    def add(self, value):
        self.n += 1
        if len(self.values) < 127:
            self.values.append(value)
        else:
            slot = ((self.n * 2654435761) & 0xffffffff) % self.n
            if slot < 127:
                self.values[slot] = value

    def result(self):
        return [round(statistics.median(self.values), 1), self.n]


def build(args):
    network = json.loads(gzip.decompress(args.network.read_bytes()) if args.network.suffix == ".gz" else args.network.read_bytes())
    line_modes = {l['id']: l['mode'] for l in network['lines']}
    wanted = set()
    for p in network['patterns']:
        line = network['lines'][p['line']]['id']
        for a, b in zip(p['stops'], p['stops'][1:]):
            wanted.add((line, network['stops'][a]['id'], network['stops'][b]['id']))
    digest = hashlib.sha256()
    with args.input.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            digest.update(chunk)
    rides = collections.defaultdict(Sample)
    departures = collections.defaultdict(set)
    dates = set()
    with zipfile.ZipFile(args.input) as z:
        services = collections.defaultdict(set)
        weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        for r in records(z, 'calendar'):
            d = dt.datetime.strptime(r['start_date'], '%Y%m%d').date()
            end = dt.datetime.strptime(r['end_date'], '%Y%m%d').date()
            while d <= end:
                if r[weekdays[d.weekday()]] == '1':
                    services[r['service_id']].add(d)
                d += dt.timedelta(days=1)
        for r in records(z, 'calendar_dates'):
            d = dt.datetime.strptime(r['date'], '%Y%m%d').date()
            if r['exception_type'] == '1':
                services[r['service_id']].add(d)
            else:
                services[r['service_id']].discard(d)
        for values in services.values():
            dates.update(values)
        # One real representative service date per weekday category. Headways are
        # calculated within that date, never by mixing mutually exclusive trips.
        representative = {}
        for d in sorted(dates):
            representative.setdefault(day_kind(d), d)
        trips = {r['trip_id']: (r['route_id'], r['service_id']) for r in records(z, 'trips') if r['route_id'] in line_modes}
        previous = {}
        count = 0
        for r in records(z, 'stop_times'):
            trip = trips.get(r['trip_id'])
            if not trip:
                continue
            line, service = trip
            arrival, departure = seconds(r['arrival_time']), seconds(r['departure_time'])
            if arrival is None or departure is None:
                previous.pop(r['trip_id'], None)
                continue
            service_dates = [d for d in representative.values() if d in services[service]]
            seq = int(r['stop_sequence'])
            before = previous.get(r['trip_id'])
            if before:
                stop, leave, prior_seq = before
                delta = arrival - leave
                if seq > prior_seq and 0 < delta <= 7200 and (line, stop, r['stop_id']) in wanted:
                    for d in service_dates:
                        kind = day_kind(d + dt.timedelta(days=leave // 86400))
                        rides['|'.join((line, stop, r['stop_id'], kind, band(leave)))].add(delta)
            if r.get('pickup_type', '') in ('', '0'):
                for d in service_dates:
                    actual_date = d + dt.timedelta(days=departure // 86400)
                    departures[(line, r['stop_id'], actual_date, band(departure))].add(departure % 86400)
            previous[r['trip_id']] = (r['stop_id'], departure, seq)
            count += 1
            if count % 1000000 == 0:
                print(f'{count:,} retained stop-time rows', flush=True)
    waits = collections.defaultdict(Sample)
    mode_waits = collections.defaultdict(Sample)
    for (line, stop, actual_date, time_band), times in departures.items():
        kind = day_kind(actual_date)
        times = sorted(times)
        for a, b in zip(times, times[1:]):
            if 0 < b-a <= 7200:
                waits['|'.join((line, stop, kind, time_band))].add((b-a)/2)
                mode_waits['|'.join((line_modes[line], kind, time_band))].add((b-a)/2)
    result = {'version': 'idfm-time-' + digest.hexdigest()[:12] + '-v2', 'networkVersion': network['version'],
              'source': {'url': args.source_url, 'sha256': digest.hexdigest(), 'feedDates': [str(min(dates)), str(max(dates))],
                         'representativeDates': {k: str(v) for k, v in representative.items()},
                         'method': 'Median scheduled inter-stop seconds and half-headway waits, bounded 127-value reservoirs; representative weekday/Saturday/Sunday with after-midnight calendar rollover; no historical service assertion',
                         'license': 'Licence Mobilité'},
              'rides': {k: v.result() for k, v in rides.items()}, 'waits': {k: v.result() for k, v in waits.items()},
              'modeWaits': {k: v.result() for k, v in mode_waits.items()},
              'fallbackKmh': {'walking': 4.8, 'cycling': 15, 'metro': 25, 'rer': 45, 'train': 50, 'tram': 18, 'bus': 15}}
    payload = (json.dumps(result, separators=(',', ':')) + '\n').encode()
    args.output.write_bytes(gzip.compress(payload, mtime=0) if args.output.suffix == '.gz' else payload)
    print(json.dumps({'rides': len(rides), 'waits': len(waits), 'bytes': args.output.stat().st_size,
                      'representativeDates': result['source']['representativeDates']}, indent=2))


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('input', type=Path)
    p.add_argument('--network', type=Path, default=Path('public/data/idfm-netmob-transit.json.gz'))
    p.add_argument('--output', type=Path, default=Path('public/data/idfm-timing.json.gz'))
    p.add_argument('--source-url', required=True)
    build(p.parse_args())
