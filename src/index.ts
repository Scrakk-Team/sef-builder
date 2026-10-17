// Copyright 2026 Scrakk Studio
// SPDX-License-Identifier: Apache-2.0
// Licencia completa en LICENSE (Apache License 2.0).

/**
 * SEF tooling — CLI.
 *
 *   sef create <nombre> [dir-destino]
 *   sef build <dir-paquete>
 *   sef pack <dir-paquete>
 *   sef validate <dir-paquete>
 */

import * as fs from 'node:fs/promises'
import { resolve } from 'node:path'
import { createScaffold, buildBundle, packSef } from './api.ts'
import { validatePackage } from './schema.ts'
import { generateSigningKey, verifySefFile } from './sign.ts'

const USAGE = `sef — Scrakk Studio extension tooling (SEF)

uso:
  sef create <nombre> [dir-destino]   scaffold con panel de ejemplo
  sef build <dir-paquete>             bundle → dist/modules.js
  sef pack <dir-paquete> [--key <pem>]  valida y escribe <dir>.sef (firma si hay clave)
  sef validate <dir-paquete>            solo valida
  sef keygen [dir]                      genera un par Ed25519 para firmar
  sef verify <archivo.sef> [--pubkey <pem>]  verifica la firma

opciones:
  --key <pem>                         clave privada Ed25519 (o SEF_SIGNING_KEY)
  --pubkey <pem>                      clave pública esperada para verify
  -v, --version                       versión del CLI
  -h, --help                          esta ayuda`

declare const __SEF_VERSION__: string | undefined

async function readVersion(): Promise<string> {
  // En el bundle/binary la versión viene inyectada en build-time; en `src/`
  // (Node directo) cae al `package.json`.
  if (typeof __SEF_VERSION__ === 'string') return __SEF_VERSION__
  try {
    const url = new URL('../package.json', import.meta.url)
    const raw = await fs.readFile(url, 'utf-8')
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2)

  switch (command) {
    case 'create': {
      const name = args[0]
      if (!name) throw new Error('uso: sef create <nombre> [dir]')
      const target = resolve(args[1] ?? '.')
      const root = await createScaffold({ name, targetDir: target })
      console.log(`✓ scaffold creado en ${root}`)
      break
    }
    case 'build': {
      const dir = resolve(args[0] ?? '.')
      const { outPath, modules } = await buildBundle(dir)
      console.log(`✓ bundle: ${outPath} (${modules.length} módulos)`)
      break
    }
    case 'pack': {
      const dir = resolve(args.find((arg) => !arg.startsWith('-')) ?? '.')
      const keyFlag = args.indexOf('--key')
      const keyPath = keyFlag >= 0 ? args[keyFlag + 1] : process.env.SEF_SIGNING_KEY
      const signingKeyPem = keyPath ? await fs.readFile(resolve(keyPath), 'utf-8') : undefined
      const issues = await validatePackage(dir)
      if (issues.length > 0) {
        for (const issue of issues) console.error(`✗ ${issue.field}: ${issue.message}`)
        throw new Error('validación fallida — no se empaqueta')
      }
      if (!signingKeyPem) {
        console.warn('⚠ paquete SIN FIRMA: el market puede rechazarlo (usá --key o SEF_SIGNING_KEY)')
      }
      const outPath = await packSef(dir, { signingKeyPem })
      console.log(`✓ paquete${signingKeyPem ? ' firmado' : ''}: ${outPath}`)
      break
    }
    case 'keygen': {
      const outDir = resolve(args.find((arg) => !arg.startsWith('-')) ?? '.')
      const keys = await generateSigningKey(outDir)
      console.log(`✓ clave privada: ${keys.privateKeyPath} (0600)`)
      console.log(`✓ clave pública: ${keys.publicKeyPath}`)
      console.log(`  keyId: ${keys.keyId}`)
      break
    }
    case 'verify': {
      const file = args.find((arg) => !arg.startsWith('-'))
      if (!file) throw new Error('uso: sef verify <archivo.sef> [--pubkey <pem>]')
      const pubFlag = args.indexOf('--pubkey')
      const pubPath = pubFlag >= 0 ? args[pubFlag + 1] : undefined
      const trusted = pubPath ? await fs.readFile(resolve(pubPath), 'utf-8') : undefined
      const result = await verifySefFile(resolve(file), trusted)
      if (result.ok) {
        console.log(`✓ firma válida (${result.keyId})`)
      } else {
        console.error(`✗ ${result.reason ?? 'firma inválida'}`)
        process.exitCode = 1
      }
      break
    }
    case 'validate': {
      const dir = resolve(args[0] ?? '.')
      const issues = await validatePackage(dir)
      if (issues.length === 0) {
        console.log('✓ paquete válido')
      } else {
        for (const issue of issues) console.error(`✗ ${issue.field}: ${issue.message}`)
        process.exitCode = 1
      }
      break
    }
    case 'version':
    case '-v':
    case '--version':
      console.log(await readVersion())
      break
    case 'help':
    case '-h':
    case '--help':
      console.log(USAGE)
      break
    default:
      console.log(USAGE)
      process.exitCode = command ? 1 : 0
  }
}

main().catch((error) => {
  console.error('✗', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
