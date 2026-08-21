# TODO

Keep this as the active queue. Completed chronology belongs in Git history, not here.

## Reliability And External Services

- [ ] Cancel or coalesce queued reverse-geocode work when a point is moved again or deleted; explicit location search must remain prioritized without exceeding the shared Nominatim rate limit.

## Data And Workflow

- [ ] Add station-library JSON import/export with schema validation and a documented compatibility contract.
- [ ] Decide whether generated preview trails remain append-only run history or can be cleared automatically on regeneration.
- [ ] Improve OSM station discovery filters so broad railway results are easier to curate.

## Verification

- [ ] Add an app-level render lifecycle test covering store notifications, scheduled renders, and targeted progress patches.
- [ ] Add a deterministic large-preview benchmark that verifies Leaflet layer counts in addition to pure preview-segment counts.
- [ ] Keep the in-app-browser smoke fixture current: search Vincennes, select the French result, search Géodata Paris, select the Champs-sur-Marne result, and verify narrow-screen controls.
