# NetMob pilot public supporting data

The user-selected NetMob Parquet datasets are not distributed with this application. Their original terms continue to apply to source fields retained in exports.

## Administrative supplement

`netmob-boundaries.json` contains only 22 public boundaries retrieved 2026-09-14. Each feature retains its exact code, name and source URL; no source boundary is replaced when EMG already provides it.

- Paris `75101`–`75120`: [Ville de Paris / Direction de l’Urbanisme — Arrondissements](https://opendata.paris.fr/explore/dataset/arrondissements/), [ODbL](https://opendatacommons.org/licenses/odbl/1-0/). Retain the `c_arinsee` identity and `l_ar` name from the [GeoJSON export](https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/arrondissements/exports/geojson).
- Guillerval `91294` and Mondreville `77297`: [API Découpage administratif](https://geo.api.gouv.fr/decoupage-administratif/communes), `GET /communes/{code}?format=geojson&geometry=contour`. The [Contours administratifs dataset](https://www.data.gouv.fr/datasets/contours-administratifs) supplies this API, derives metropolitan boundaries from IGN Admin Express, and declares ODbL. These are contemporary generalized contours, not verified survey-date boundaries.

The complete derivative boundary data is supplied in the JSON. Attribute Ville de Paris and data.gouv.fr / IGN, retain the above source/license links, and retain ODbL when redistributing the supplement.

## Transit geometry and timing

`idfm-netmob-transit.json.gz` and `idfm-timing.json.gz` derive from [IDFM GTFS resource 80921](https://transport.data.gouv.fr/resources/80921). They use the [pinned 2026-09-07 archive](https://transport-data-gouv-fr-resource-history-prod.cellar-c2.services.clever-cloud.com/80921/80921.20260907.062127.490505.zip), SHA-256 `76354f2350be3d38b79db52413ab13171c11e839f7e66b2b0da0c2cfe3fd1f51`. Feed calendars span 2026-09-04–2026-10-06. Timing statistics use representative service dates September 4, 5 and 6 with after-midnight rollover.

Service/stop/transfer/timetable data: Île-de-France Mobilités, [Licence Mobilité](https://cloud.fabmob.io/s/eYWWJBdM3fQiFNm). Shape geometry: Île-de-France Mobilités / © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). The [existing notice](idfm-transit.LICENSE.md) explains the source documentation and component attribution. The NetMob network additionally retains matching TER patterns and marks their lines `railClass: regional`; Manual continues to use its existing separate network.

Reproduce with Python standard-library tools and the pinned ZIP stored outside Git:

```sh
python3 scripts/build-transit-network.py /path/to/IDFM-20260907.zip --retrieved 2026-09-07 --include-ter --output public/data/idfm-netmob-transit.json.gz
python3 scripts/build-transit-timing.py /path/to/IDFM-20260907.zip --network public/data/idfm-netmob-transit.json.gz --source-url https://transport-data-gouv-fr-resource-history-prod.cellar-c2.services.clever-cloud.com/80921/80921.20260907.062127.490505.zip
```

The network and timing source objects retain versions, hashes, method and counts. Both `.gz` files contain UTF-8 JSON, decoded lazily using browser `DecompressionStream`. See [NETMOB.md](../../NETMOB.md) for estimates, fallbacks and limitations. These assets do not establish historical or current operating availability for a generated journey.
