# Active backlog

Confirm the relevant item against source before starting. Completed work belongs in git; recurring checks belong in AGENTS/LESSONS/PERFORMANCE.

- [ ] Validate the [local NetMob runner](NETMOB_RUNS.md) on 1,000/10,000 sequential rows before a full run; add targeted retry of terminal failures. Browser supervision is implemented; hard-kill/endurance verification remains. Browser/Manual durable batches remain separate work. Move Manual transit search into a worker.
- [ ] Match RER access to the official bike-parking inventory before offering verified parking; current cycling + transit is explicitly assumption-based.
- [ ] Add place-library JSON import/export with schema validation and a compatibility contract.
- [ ] Add editable polygon areas and optional station pinning to Manual; keep automatic per-point station choice as the default.
- [ ] Add an app-level lifecycle test spanning store notifications, scheduled renders and targeted progress patches; helper tests already exist.
- [ ] Add a deterministic large-preview benchmark that checks actual Leaflet layer counts, beyond pure segment counts.
- [ ] Extend transit coverage/refresh tooling and replace approximate internal station connectors where reliable pathway geometry is available.
- [ ] Consider service-date-aware scheduled journeys beyond the NetMob recent-feed estimates; retain the independent Manual synthetic workflow.

- [ ] If bulk timed observations are needed, extend the selected-route movement/GNSS pilot with bounded export and explicit cadence/storage controls. Compact full-run path variation is separate; see [MOVEMENT_SIMULATION.md](MOVEMENT_SIMULATION.md) and [NETMOB_RUNS.md](NETMOB_RUNS.md).

- [ ] Extend NetMob beyond the pilot with weighted-population expansion and linked daily journeys, after evaluating coverage and sampling bias. See [NETMOB.md](NETMOB.md).
