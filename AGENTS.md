# Agent Notes

- When changing `src/gas/apps_script.gs`, update all GAS version references in the same change:
  - the header title version near the top of `src/gas/apps_script.gs`
  - the top changelog block in `src/gas/apps_script.gs` with the current date and summary
  - the `gasVersion` value returned by `handleGetSettings()`
  - `EXPECTED_GAS_VERSION` in `src/web/features/settings/settings_fetch.js`
- Keep operational deployment notes in `DEPLOYMENT.md` current when deployment, GAS redeploy, public-data API, or web-root behavior changes.
