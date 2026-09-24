# Project guidance

Vite/TypeScript browser app for synthetic transit (including bus), cycling and driving trips. Optional native local ORS supplies street routes. The optional Node NetMob runner reuses domain modules for bounded, resumable local exports; the existing lazy NetMob UI controls it through an optional loopback companion. Manual/browser pilot state remains independent.

## Read by task

Read only the relevant document or section; verify changing facts in source and git.

- [ARCHITECTURE.md](ARCHITECTURE.md): module ownership, state, generation, build/deploy.
- [LESSONS.md](LESSONS.md): regression traps for map, panel, async, or setup changes.
- [PERFORMANCE.md](PERFORMANCE.md): rendering, routing, caching, bundle work, and smoke fixture.
- [MOVEMENT_SIMULATION.md](MOVEMENT_SIMULATION.md): candidate movement fitting, selected-route noise, bounds and calibration experiments.
- [NETMOB.md](NETMOB.md): NetMob input workers, geography, ordered modes, timing, fitting and pilot benchmarks.
- [NETMOB_RUNS.md](NETMOB_RUNS.md): local runner, visible output, checkpoints, disk limits and full-run gates.
- [PARQUET_EXPORT.md](PARQUET_EXPORT.md): batch export, schema, partitioning and measured comparisons.
- [OFFLINE_ROUTING.md](OFFLINE_ROUTING.md): local ORS setup, lifecycle commands, and local-server benchmarks; `.local-ors/` holds ignored runtime/data.
- [GPX_EXPORT.md](GPX_EXPORT.md): exported XML changes.
- [SOURCES.md](SOURCES.md): external service policy or infrastructure assumptions.
- [TODO.md](TODO.md): choosing follow-up work; the current request defines scope.
- [README.md](README.md): user-facing behavior and setup.

## Commands and verification

- Dependency setup when needed: `npm ci`; runtime pin: `.node-version`.
- Local job controller: `npm run netmob:serve` → `127.0.0.1:5199`; keep running independently of the browser. See NETMOB_RUNS.
- Dev: `npm run dev` → `http://127.0.0.1:5198/`.
- Preview: `npm run preview` → `http://127.0.0.1:4198/`.
- Full gate: `npm run check` (tests, build, initial-bundle budget).
- Focused test: `npm run test:run -- src/test/<name>.test.ts`.
- Performance: `npm run benchmark`.

Run the full gate once before code/config handoff. Focused tests are useful during iteration; do not repeat passing checks without a change or unresolved concern. Documentation-only edits need link/path, contract, and diff checks; CI still runs its configured gate.

Use the in-app browser for relevant UI checks; report capability gaps and any fallback. Preserve saved user data. Fixed strict ports protect origin-scoped localStorage: identify an occupying process instead of changing the port. Mock all public services in automated tests.

## Invariants

- Domain helpers belong in `src/lib/`; UI ownership is mapped in ARCHITECTURE.
- Escape dynamic panel HTML through `src/ui/html.ts`; treat persisted data and IDs as untrusted.
- Normalize loaded state through `stateStore.ts`; incompatible schema changes need a deliberate version/migration contract.
- Use `stationRadius.ts` for radius normalization/conversion/display; sampling and hit tests must use the same normalized station radius.
- Keep generated JS out of `src/` and preserve TypeScript `noEmit`.
- ORS keys remain user-provided browser state; keep them out of logs, fixtures, and commits.

Update the document that owns a changed contract. Keep TODO to unresolved work and history in git. `CODEX_MEMO.md` is ignored private scratch, not durable guidance.
