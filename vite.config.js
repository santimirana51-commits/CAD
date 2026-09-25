import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      '@core': resolve(import.meta.dirname, 'src/core'),
      '@agent': resolve(import.meta.dirname, 'src/agent'),
      '@ui': resolve(import.meta.dirname, 'src/ui'),
      '@shared': resolve(import.meta.dirname, 'src/shared'),
      '@features': resolve(import.meta.dirname, 'src/features')
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: 'hidden',
    // dynamic import -> automatic chunk splitting
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        // legacy entry kept for compat, not bundled
      },
      output: {
        manualChunks(id) {
          if (id.includes('src/agent/pipeline/clean')) return 'agent-clean';
          if (id.includes('src/agent/pipeline/site')) return 'agent-site';
          if (id.includes('src/agent/pipeline/selection')) return 'agent-selection';
          if (id.includes('src/agent/panel/dom') || id.includes('src/agent/panel/thread') || id.includes('src/agent/panel/tool-row')) return 'agent-panel-ui';
          if (id.includes('src/agent/panel/geometry') || id.includes('src/agent/panel/animation')) return 'agent-geometry';
          if (id.includes('src/features/plan')) return 'feature-plan';
          if (id.includes('src/features/dxf') || id.includes('src/legacy/dxf.js')) return 'feature-dxf';
          if (id.includes('src/features/threed') || id.includes('src/legacy/gl3d') || id.includes('src/legacy/solid3d') || id.includes('src/legacy/csg3d')) return 'feature-3d';
          if (id.includes('src/ui/icons')) return 'ui-icons';
          if (id.includes('src/legacy/engine.js') || id.includes('src/core/engine')) return 'core-engine';
          if (id.includes('src/core/shell/app')) return 'core-shell';
        }
      }
    },
    chunkSizeWarningLimit: 1200
  },
  server: {
    port: 5173,
    strictPort: false
  }
});
