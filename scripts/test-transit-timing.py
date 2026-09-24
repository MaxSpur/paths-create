#!/usr/bin/env python3
"""Small offline fixture for the GTFS timing preprocessor."""
import argparse
import contextlib
import csv
import gzip
import importlib.util
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('timing', Path(__file__).with_name('build-transit-timing.py'))
timing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(timing)


class TimingTest(unittest.TestCase):
    def test_calendar_exceptions_midnight_medians_and_waits(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            network = {'version': 'fixture', 'lines': [{'id': 'L', 'mode': 'bus'}],
                       'stops': [{'id': 'A'}, {'id': 'B'}], 'patterns': [{'line': 0, 'stops': [0, 1]}]}
            (root / 'network.json').write_text(json.dumps(network))
            with zipfile.ZipFile(root / 'feed.zip', 'w') as z:
                def table(name, headers, rows):
                    text = io.StringIO(); writer = csv.writer(text); writer.writerow(headers); writer.writerows(rows)
                    z.writestr(name + '.txt', text.getvalue())
                table('calendar', ['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'],
                      [['F', 0, 0, 0, 0, 1, 0, 0, '20260904', '20260906'], ['X', 0, 0, 0, 0, 1, 0, 0, '20260904', '20260906']])
                table('calendar_dates', ['service_id', 'date', 'exception_type'], [['X', '20260904', 2], ['S', '20260905', 1]])
                table('trips', ['route_id', 'service_id', 'trip_id'], [['L', 'F', 'a'], ['L', 'F', 'b'], ['L', 'X', 'excluded'], ['L', 'S', 'sat']])
                table('stop_times', ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence', 'pickup_type'],
                      [['a', '25:00:00', '25:00:00', 'A', 1, 0], ['a', '25:05:00', '25:05:00', 'B', 2, 1],
                       ['b', '25:10:00', '25:10:00', 'A', 1, 0], ['b', '25:16:00', '25:16:00', 'B', 2, 1],
                       ['excluded', '25:05:00', '25:05:00', 'A', 1, 0], ['excluded', '25:06:00', '25:06:00', 'B', 2, 1],
                       ['sat', '12:00:00', '12:00:00', 'A', 1, 0], ['sat', '12:10:00', '12:10:00', 'B', 2, 1]])
            with contextlib.redirect_stdout(io.StringIO()):
                timing.build(argparse.Namespace(input=root / 'feed.zip', network=root / 'network.json', output=root / 'timing.json.gz', source_url='fixture'))
            result = json.loads(gzip.decompress((root / 'timing.json.gz').read_bytes()))
            self.assertEqual(result['rides']['L|A|B|saturday|night'], [330.0, 2])
            self.assertEqual(result['waits']['L|A|saturday|night'], [300.0, 1])
            self.assertEqual(result['rides']['L|A|B|saturday|day'], [600.0, 1])
            self.assertNotIn('L|A|B|weekday|night', result['rides'])
            self.assertNotIn('L|B|saturday|night', result['waits'])
            self.assertEqual(result['networkVersion'], 'fixture')

    def test_bounded_reservoir_and_invalid_times(self):
        sample = timing.Sample()
        for n in range(10000): sample.add(n)
        self.assertEqual(len(sample.values), 127)
        self.assertEqual(sample.result()[1], 10000)
        self.assertIsNone(timing.seconds('-1:00:00'))
        self.assertIsNone(timing.seconds('broken'))
        self.assertEqual(timing.seconds('25:30:00'), 91800)


if __name__ == '__main__':
    unittest.main()
