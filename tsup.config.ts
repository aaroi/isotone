import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      index: 'src/react/index.ts',
      core: 'src/core/index.ts',
      server: 'src/server/index.ts',
      serve: 'src/serve/index.ts',
      'vite-plugin': 'src/vite/index.ts',
      cli: 'src/cli/index.ts',
    },
    format: ['esm'],
    target: 'es2022',
    dts: true,
    sourcemap: true,
    clean: true,
    // The host provides these; keeping them external avoids a second React/Vite
    // install whose types clash with the consumer's own.
    external: ['react', 'react-dom', 'react/jsx-runtime', 'vite'],
    // Ship only the icons we use; CLI/standalone users need no React peers.
    noExternal: ['lucide-react'],
  },
  {
    // The standalone bundle is the opposite trade: React goes INSIDE, because
    // the page it drops into may have none, may have another version, or may
    // not be a bundled app at all. `isotone serve` serves this file.
    // tsup suffixes an iife build with `.global`, so this emits
    // dist/isotone.global.js.
    entry: { 'isotone': 'src/standalone/index.ts' },
    format: ['iife'],
    target: 'es2020',
    dts: false,
    sourcemap: false,
    clean: false,
    minify: true,
    external: [],
    // The panel is a dev tool, but its private React runtime needs no dev build.
    // This does not affect the host application's React or environment.
    define: { 'process.env.NODE_ENV': '"production"' },
  },
]);
