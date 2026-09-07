# Île-de-France transit snapshot

`idfm-transit.json` is an extract of [Île-de-France Mobilités GTFS Datahub](https://prim.iledefrance-mobilites.fr/fr/jeux-de-donnees/offre-horaires-tc-gtfs-idfm), downloaded on 2026-09-07 from the [official ZIP](https://eu.ftp.opendatasoft.com/stif/GTFS/IDFM-gtfs.zip). The JSON `source` object records its SHA-256, source calendar coverage, retained operator attribution records, transformation parameters and rejection counts.

This data has its own licenses, separate from application code:

- Service, stop and transfer information: [Licence Mobilité, version 03.02.2021](https://cloud.fabmob.io/s/eYWWJBdM3fQiFNm).
- Shape geometry, including simplified/projected `patterns[].coordinates` and their offsets: [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/). © OpenStreetMap contributors; geometry produced by Île-de-France Mobilités. See [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright).

The [official IDFM GTFS documentation](https://eu.ftp.opendatasoft.com/stif/GTFS/opendata_gtfs.pdf), February 2026, identifies Licence Mobilité for the GTFS feed (page 3) and ODbL for `shapes.txt` (page 37). Retain these component licenses and source notices when redistributing the extract. The downloadable JSON and [`scripts/build-transit-network.py`](../../scripts/build-transit-network.py) provide the derivative data and reproducible transformation method.

Suggested attribution for public outputs, with source and license links:

Transit data: [Île-de-France Mobilités — GTFS Datahub](https://prim.iledefrance-mobilites.fr/fr/jeux-de-donnees/offre-horaires-tc-gtfs-idfm), [Licence Mobilité](https://cloud.fabmob.io/s/eYWWJBdM3fQiFNm). Geometry: Île-de-France Mobilités / [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright), [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Snapshot: 2026-09-07.

## Transformation and limits

The builder retains metro, RER, Transilien and tram services (`route_type` 0, 1, 2; TER excluded). It deduplicates directed service patterns while preserving stop order, boarding/alighting restrictions and source shape variants. It projects stops onto their own service shape, simplifies each inter-stop section by at most 3 metres, and retains the projected stop positions. It excludes patterns with missing geometry, failed directed alignment or any stop more than 400 metres from its shape. Only explicit directed GTFS transfer pairs are retained; parent-station endpoints expand to retained child stops. No proximity-based interchanges or straight-line rail fallback are created.

This is a dated network for synthetic trajectories. It omits schedules, travel times and operating-day restrictions, and does not establish that a journey runs at any particular time. IDFM generates shapes automatically from stop positions using OpenStreetMap. These traces are approximate; they are not surveyed track geometry. GTFS transfer pairs describe connectivity, not exact internal station walking paths. The extracted snapshot does not include `pathways.txt` or establish accessibility.

Rebuild from a newly downloaded ZIP when current coverage is needed:

```sh
python3 scripts/build-transit-network.py /path/to/IDFM-gtfs.zip --retrieved YYYY-MM-DD
```

Update the snapshot date in this notice after rebuilding. The source ZIP is an intermediate and is not distributed with the application.
