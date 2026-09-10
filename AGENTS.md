# Project guidance

Browser-only Vite/TypeScript app for synthetic transit (including bus), cycling and driving GPX trips. UI/transit processing stays in the browser; optional native local ORS supplies street routes. See OFFLINE_ROUTING.md for setup and operations.

## Read by task

Read only the relevant document or section; verify changing facts in source and git.

- [ARCHITECTURE.md](ARCHITECTURE.md): module ownership, state, generation, build/deploy.
- [LESSONS.md](LESSONS.md): regression traps for map, panel, async, or setup changes.
- [PERFORMANCE.md](PERFORMANCE.md): rendering, routing, caching, bundle work, and smoke fixture.
- [GPX_EXPORT.md](GPX_EXPORT.md): exported XML changes.
- [SOURCES.md](SOURCES.md): external service policy or infrastructure assumptions.
- [TODO.md](TODO.md): choosing follow-up work; the current request defines scope.
- [README.md](README.md): user-facing behavior and setup.

## Commands and verification

- Install: `npm ci`; runtime pin: `.node-version`.
- Dev: `npm run dev` → `http://127.0.0.1:5198/`.
- Preview: `npm run preview` → `http://127.0.0.1:4198/`.
- Full gate: `npm run check` (tests, build, initial-bundle budget).
- Focused test: `npm run test:run -- src/test/<name>.test.ts`.
- Performance: `npm run benchmark`.
- Local ORS: `npm run ors:install`, `ors:start`, `ors:status`, `ors:stop`; `.local-ors/` is ignored runtime/data. `ors:benchmark -- 1000` explicitly calls only that local server.

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
