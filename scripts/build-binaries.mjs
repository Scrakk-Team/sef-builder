// Copyright 2026 Scrakk Studio
// SPDX-License-Identifier: Apache-2.0
// Licencia completa en LICENSE (Apache License 2.0).

/**
 * Compila binarios standalone (sin Node) con `bun build --compile`.
 *
 *   bun scripts/build-binaries.mjs
 *
 * Salida: `release/sef-<os>-<arch>[.exe]`. La versión se inyecta como
 * `__SEF_VERSION__` (el binario no tiene `package.json` al lado). `esbuild`
 * queda externo porque el binario usa el bundler nativo `Bun.build`.
 * Van a `release/` (no a `dist/`) para no entrar al tarball de npm.
 */

import { mkdir } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { $ } from 'bun'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf-8'))

const TARGETS = [
  ['linux-x64', 'bun-linux-x64'],
  ['windows-x64', 'bun-windows-x64'],
  ['darwin-arm64', 'bun-darwin-arm64']
]

await mkdir(new URL('../release/', import.meta.url), { recursive: true })

for (const [name, target] of TARGETS) {
  const ext = target.includes('windows') ? '.exe' : ''
  const out = new URL(`../release/sef-${name}${ext}`, import.meta.url).pathname
  await $`bun build --compile --minify --external esbuild --target=${target} --define __SEF_VERSION__=${JSON.stringify(pkg.version)} --outfile ${out} src/index.ts`
  console.log(`✓ release/sef-${name}${ext}`)
}
