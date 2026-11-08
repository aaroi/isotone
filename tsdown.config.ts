import { defineConfig } from 'tsdown';

// lucide-react marks its modules "use client"; the panel only ever runs in the
// browser, so the directive means nothing once bundled.
const checks = { moduleLevelDirective: false };

export default defineConfig([
  {
    entry: {
      // One file per package.json subpath, named after it, plus the binary.
      react: 'src/react/index.ts',
      core: 'src/core/index.ts',
      serve: 'src/serve/index.ts',
      vite: 'src/vite/index.ts',
      cli: 'src/cli/index.ts',
      bin: 'src/cli/bin.ts',
    },
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    fixedExtension: false,
    dts: true,
    checks,
    // Maps keep file and line names for stack traces; the sources themselves
    // are not shipped.
    sourcemap: true,
    outputOptions: { sourcemapExcludeSources: true },
    // lucide-react has no `exports`; prefer its ES build so unused icons shake out.
    inputOptions: { resolve: { mainFields: ['module', 'main'] } },
    deps: {
      // The host provides these; keeping them external avoids a second React/Vite
      // install whose types clash with the consumer's own.
      neverBundle: ['react', 'react-dom', /^react\//, /^react-dom\//, 'vite'],
      // Ship only the icons we use; CLI/standalone users need no React peers.
      onlyBundle: ['lucide-react'],
    },
  },
  {
    // The standalone bundle is the opposite trade: React goes INSIDE, because
    // the page it drops into may have none, may have another version, or may
    // not be a bundled app at all. `isotone serve` serves this file as
    // dist/isotone.global.js.
    entry: { isotone: 'src/standalone/index.ts' },
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    outputOptions: { entryFileNames: '[name].global.js' },
    dts: false,
    checks,
    sourcemap: false,
    clean: false,
    minify: true,
    deps: { alwaysBundle: [/./], onlyBundle: false },
    // The panel is a dev tool, but its private React runtime needs no dev build.
    // This does not affect the host application's React or environment.
    define: { 'process.env.NODE_ENV': '"production"' },
  },
]);
