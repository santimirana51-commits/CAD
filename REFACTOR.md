# pixelbay CAD agent-panel â€” Refactor Dinamis

## Sebelum (flat 41 file, IIFE global)

```
agent-panel/
  agent-panel.js (4539 baris, window.Nasj)
  app.js (1.4M)  engine.js (566k)  tools.js (1.1M)  dxf.js ...
  icons.js .. icons4.js
  <script> tag urutan manual, semua di-parse di awal
```

Masalah: tidak ada `import`, tidak ada chunk, tambah tool = edit monolit, DXF/3D/plan selalu ter-load walau tidak dipakai.

## Sesudah (feature-based + ES modules + dynamic import)

```
agent-panel/
  package.json, vite.config.js, index.html
  src/
    shared/config/tunables.js      <- agent-panel.js:80  (VIEW_FIT..NEUTRAL)
    shared/utils/helpers.js         <- agent-panel.js:109 (esc, clamp, errText)
    shared/lib/nasj.js              <- ganti window.Nasj global
    ui/icons/agent-icons.js         <- agent-panel.js:27  (AI_ICONS + register)
    agent/pipeline/clean.js         <- agent-panel.js:149 (cleanForVectorizer + Otsu)
    agent/pipeline/site.js          <- agent-panel.js:273 (plotFrame, plotMetres, largestBoundaryIn)
    agent/pipeline/selection.js     <- agent-panel.js:718 (selEntities, buildWindowReference)
    agent/tools/registry.js         <- dynamic import {draw_cad, draw_plan, cad_document..}
    agent/state/store.js            <- ganti st monolit agent-panel.js:924
    core/engine/viewport.js         <- shim engine.js
    features/plan/run.js            <- lazy plan.js (108k)
    features/dxf/loader.js          <- lazy dxf.js (164k)
    features/threed/loader.js       <- lazy gl3d/solid3d/csg3d
    entry.js                        <- bootstrap dinamis
    agent/panel/compat.js           <- backward-compat window.* shim
  legacy.html                       <- urutan lama untuk regresi
```

## Cara Jadi Dinamis

1. **Dynamic import = code splitting otomatis**
   ```js
   // hanya load saat agent panggil
   const { run } = await import('@agent/tools/registry.js').then(m => m.loadTool('draw_plan'))
   ```
   Vite config `manualChunks` -> `agent-clean.js`, `agent-site.js`, `feature-plan.js`, `feature-dxf.js`, `feature-3d.js`

2. **Config-driven + plugin registry**
   ```js
   import { TOOL_DEFS } from '@agent/tools/registry.js'
   // tambah tool baru = 1 file + 1 baris, tanpa sentuh agent-panel.js
   NasjDynamic.registerTool({ name:'my_tool', loader:()=>import('./my-tool.js') })
   NasjDynamic.loadFeature('dxf') // load on OPEN, bukan on boot
   ```

3. **Backward compat 100%**
   - `src/agent/panel/compat.js` expose `window.__nasjCompat`, `window.__nasjSite` sehingga `app.js`/`engine.js`/`commands.js` lama tetap jalan tanpa edit.
   - `legacy.html` simpan urutan 41 `<script>` lama untuk diff/rollback.
   - `agent-panel.js` asli tidak dihapus â€” jadi fallback sampai migrasi selesai.

## Perintah

```bash
npm install
npm run dev     # http://localhost:5173  (HMR, chunk terlihat di Network)
npm run build   # dist/ dengan chunk terpisah
npm run preview
```

## Fase 2 â€” Selesai (2026-09-24)

- `agent-panel.js:921-4539` dipecah jadi `src/agent/panel/`:
  `state.js` (st), `dom.js` (build/composer/menu), `mentions.js` (@ + picker + history), `byok.js`, `thread.js`, `tool-row.js`, `geometry.js` (placement+framing), `animation.js` (brush+CNC), `replace-apply.js`, `plan-runner.js`, `bridge.js` -> `src/agent/bridge/nasj-api.js`, `pipeline.js`, `events.js`, `api.js`, `global-keys.js`, `Panel.js` (orchestrator)
  Raw slice disimpan di `src/agent/panel/_archive/` + `thread.js` dkk sebagai facade valid (raw di-comment, module tetap parse-able)
- `app.js`/`engine.js` dipindah ke `src/core/shell/app.js` + `src/core/engine/engine.js` (ES facade, lazy `import('../../../app.js')`)
- `src/entry.js` diperluas: `NasjDynamic.loadPanel('dom'|'thread'|'geometry'|...)` + `loadFeature('app'|'engine')` + `getState()`
- `vite.config.js` `manualChunks`: `agent-selection`, `agent-panel-ui`, `agent-geometry`, `core-shell`, `core-engine` terpisah
- Build fase 2: `âœ“ 51 modules, built in 5.90s` â€” `main.js` 4.5k, `agent-panel-ui` 7.1k, `agent-geometry` 0.5k, `mentions` 4.8k, `core-engine` 190k (lazy), `app` 790k (lazy, dulu 1.4M blocking)

## Perbedaan dinamis yang terasa

- Before: `index.html` load 41 `<script>` sinkron, `dxf.js`/`plan.js`/`3D` selalu di-parse walau user cuma chat
- After: `index.html` cuma `<script type="module" src="/src/entry.js">` â€” `NasjDynamic.loadFeature('dxf')` baru fetch `feature-dxf` (65k) saat OPEN, `loadTool('draw_plan')` baru fetch `feature-plan` saat agent panggil

## Next (opsional)

- Pindahkan logika stateful yang masih di `agent-panel.js:1623-4539` dari comment-facade ke implementasi penuh di `thread.js`/`geometry.js`/`animation.js` (hapus delegasi ke legacy)
- Hapus shim `src/core/*-loader.js` setelah `app.js`/`engine.js` native ESM
- Tambah test: `src/agent/pipeline/clean.test.js` (Otsu), `src/agent/panel/state.test.js`
