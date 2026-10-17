// Copyright 2026 Scrakk Studio
// SPDX-License-Identifier: Apache-2.0
// Licencia completa en LICENSE (Apache License 2.0).

/**
 * Firma Ed25519 del `.sef`: roundtrip, tamper de archivo/manifest, clave
 * incorrecta y paquete sin firma.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { unzipSync, zipSync } from 'fflate'
import { createScaffold, buildBundle, packSef } from '../src/api'
import {
  generateSigningKey,
  keyIdFor,
  sha256Hex,
  signAndZip,
  verifyFiles,
  verifySefFile
} from '../src/sign'

let workDir: string
let keys: Awaited<ReturnType<typeof generateSigningKey>>
let privatePem: string
let publicPem: string

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sef-sign-'))
  keys = await generateSigningKey(path.join(workDir, 'keys'))
  privatePem = await fs.readFile(keys.privateKeyPath, 'utf-8')
  publicPem = await fs.readFile(keys.publicKeyPath, 'utf-8')
})

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true })
})

async function signedPackage(): Promise<string> {
  const root = await createScaffold({ name: 'Firmada', targetDir: workDir })
  await buildBundle(root)
  return packSef(root, { signingKeyPem: privatePem })
}

describe('generateSigningKey', () => {
  it('escribe la privada con 0600 y un keyId estable', async () => {
    const stat = await fs.stat(keys.privateKeyPath)
    expect(stat.mode & 0o777).toBe(0o600)
    expect(keys.keyId).toMatch(/^sha256:[0-9a-f]{32}$/)
    expect(keyIdFor(Buffer.from('x'))).toMatch(/^sha256:[0-9a-f]{32}$/)
  })
})

describe('pack + verify', () => {
  it('firma y verifica con la clave pública', async () => {
    const sef = await signedPackage()
    const result = await verifySefFile(sef, publicPem)
    expect(result.ok).toBe(true)
    expect(result.keyId).toBe(keys.keyId)

    // sin clave esperada también verifica (TOFU)
    const tofu = await verifySefFile(sef)
    expect(tofu.ok).toBe(true)
    expect(tofu.publicKey).toBeTruthy()
  })

  it('rechaza un paquete sin firma', async () => {
    const root = await createScaffold({ name: 'Sin Firma', targetDir: workDir })
    await buildBundle(root)
    const sef = await packSef(root)
    const result = await verifySefFile(sef)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/no está firmado/)
  })

  it('rechaza si se modifica un archivo del zip', async () => {
    const sef = await signedPackage()
    const files = unzipSync(new Uint8Array(await fs.readFile(sef)))
    files['dist/modules.js'] = new TextEncoder().encode('export const modules = {}')
    const tampered = path.join(workDir, 'tampered.sef')
    await fs.writeFile(tampered, zipSync(files))
    const result = await verifySefFile(tampered, publicPem)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/alterado/)
  })

  it('rechaza si se agrega un archivo', async () => {
    const sef = await signedPackage()
    const files = unzipSync(new Uint8Array(await fs.readFile(sef)))
    files['evil.js'] = new TextEncoder().encode('alert(1)')
    const tampered = path.join(workDir, 'extra.sef')
    await fs.writeFile(tampered, zipSync(files))
    const result = await verifySefFile(tampered, publicPem)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/evil.js/)
  })

  it('rechaza con una clave distinta', async () => {
    const other = await generateSigningKey(path.join(workDir, 'other'))
    const otherPem = await fs.readFile(other.publicKeyPath, 'utf-8')
    const sef = await signedPackage()
    const result = await verifySefFile(sef, otherPem)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/no confiable/)
  })

  it('rechaza una firma manipulada', async () => {
    const sef = await signedPackage()
    const files = unzipSync(new Uint8Array(await fs.readFile(sef)))
    const sig = JSON.parse(new TextDecoder().decode(files['signature.json']))
    sig.signature = Buffer.from('x'.repeat(64)).toString('base64')
    files['signature.json'] = new TextEncoder().encode(JSON.stringify(sig))
    const tampered = path.join(workDir, 'badsig.sef')
    await fs.writeFile(tampered, zipSync(files))
    const result = await verifySefFile(tampered, publicPem)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/firma/)
  })

  it('signAndZip no firma el propio signature.json', () => {
    const zipped = signAndZip(
      { 'manifest.json': new TextEncoder().encode('{}') },
      privatePem
    )
    const files = unzipSync(zipped.zip)
    expect(files['signature.json']).toBeTruthy()
    expect(zipped.signature.files['signature.json']).toBeUndefined()
    expect(verifyFiles(files).ok, verifyFiles(files).reason).toBe(true)
    expect(sha256Hex('a')).toHaveLength(64)
  })
})
