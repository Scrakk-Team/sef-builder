// Copyright 2026 Scrakk Studio
// SPDX-License-Identifier: Apache-2.0
// Licencia completa en LICENSE (Apache License 2.0).

/**
 * Bundles the CLI to `dist/index.js` (ESM, Node).
 *
 * `esbuild` and `fflate` stay **external** so they resolve from the consumer's
 * install (they are declared as runtime dependencies) instead of being frozen
 * into the published artifact. `__SEF_VERSION__` is injected so `sef --version`
 * works even where `package.json` is not next to the bundle.
 */

import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf-8'))

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  external: ['esbuild', 'fflate'],
  define: { __SEF_VERSION__: JSON.stringify(pkg.version) },
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info'
})
