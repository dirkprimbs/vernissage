import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// In dev, serve a generated site folder (index.html is ignored, its assets and site.json are used).
// VERNISSAGE_SITE=out/davinci npm run dev
const site = process.env.VERNISSAGE_SITE ? resolve(import.meta.dirname, '../..', process.env.VERNISSAGE_SITE) : resolve(import.meta.dirname, '../../out/sample');

export default defineConfig({
  plugins: [
    {
      name: 'classic-script',
      apply: 'build',
      transformIndexHtml: { order: 'post', handler: (html) => html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/, '<script defer src="$1"></script>').replace(/ crossorigin/g, '') },
    },
  ],
  base: './',
  publicDir: site,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    copyPublicDir: false,
    // inline the small Poppins woff2 files as data URIs: the viewer must be a single script + images
    assetsInlineLimit: 120000,
    assetsDir: 'app',
    chunkSizeWarningLimit: 1200,
    // one classic (non-module) script so the portfolio also opens from file://
    rollupOptions: { output: { format: 'iife', entryFileNames: 'app/viewer.js', assetFileNames: 'app/[name][extname]' } },
  },
});
