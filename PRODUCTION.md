# Production Readiness — agent-panel dynamic

## Build
- `npm ci` — reproduksibel (package-lock)
- `npm run build` — `✓ 51 modules, ~6s` — output `dist/` siap deploy statis (Vercel/Netlify/Nginx)
  - `dist/index.html` — entry ESM `main-*.js` 4.5k + CSS 142k
  - Chunks lazy: `agent-clean` 3.5k, `agent-site` 9.3k, `agent-selection` 3.6k, `agent-panel-ui` 7.1k, `core-engine` 190k, `app` 790k, `feature-dxf` 65k, `feature-3d` 38k, `plan-loader` 54k
  - `dist/assets/*.map` sourcemap aktif untuk Sentry
- `npm run preview` — serve `dist` di 4173, verifikasi no 404 untuk `assets/*`

## Runtime
- `src/entry.js` — single ESM entry, `registerAgentIcons()` di parse-time, `NasjDynamic` global — **tanpa `legacy-bundle.js` lagi (dihapus 2026-09-24, build tanpa legacy-bundle 119k)**
- `src/config/agent.config.json` — config-driven: presets/tools/features/tunables tanpa rebuild
- `NasjDynamic.loadFeature('dxf'|'threed'|'plan')` — fetch chunk on-demand (lihat `demo-dynamic.html` + Network)
- `NasjDynamic.registerTool({name, loader})` — plugin tanpa edit monolit
- Panel core 10/10 real ESM: `thread.js` 1622-2088, `tool-row.js` 2089-2295, `geometry.js` 2296-2583, `animation.js` 2584-3093, `pipeline.js` 3583-3815, `events.js` 3816-4050, `api.js` 4051-4493, `global-keys.js` 4495-4538, `replace-apply.js` 3094-3279, `plan-runner.js` 3280-3555 — semua `node --check 0 ok`

## Backward compat
- `legacy.html` — urutan 41 `<script>` lama tetap ada untuk regresi & rollback 1-file
- `src/agent/panel/compat.js` expose `window.__nasjCompat`, `window.__nasjSite` sehingga `app.js`/`engine.js`/`commands.js` lama jalan tanpa edit
- `agent-panel.js` asli tidak dihapus

## Tests & Quality
- `npm run test:clean` — `node --loader ./test-loader.js` (alias `@shared` → `src/shared`) — 5 pass: CLEAN_SIZE 2048, Otsu, nearestRatio, ptsBounds, rectPts
- `test-loader.js` — custom ESM loader untuk alias Vite di Node
- `npm run lint` — placeholder, tambah `eslint` config saat butuh

## Deploy checklist
1. `npm ci && npm run build && npm run test:clean` harus hijau
2. `npm run preview` — buka `http://localhost:4173` dan `http://localhost:4173/demo-dynamic.html`, klik semua tombol lazy, pastikan Network fetch chunk bukan 404
3. Upload `dist/` ke hosting statis — pastikan MIME `*.js` = `text/javascript`, `*.css` = `text/css`, `*.webmanifest` = `application/manifest+json`
4. Rollback: ganti `index.html` dengan `legacy.html` jika butuh

## Known gaps (tidak block produksi)
- `src/core/*-loader.js` shim untuk `cad-document`/`dxf`/`plan` masih lazy via `../../../*.js`; hapus setelah file tersebut native ESM
- 41 file flat di root (`agent-panel.js` dkk) tetap ada untuk `legacy.html` rollback, tidak dipakai `dist/index.html`
