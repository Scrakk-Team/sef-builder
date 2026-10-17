// Copyright 2026 Scrakk Studio
// SPDX-License-Identifier: Apache-2.0
// Licencia completa en LICENSE (Apache License 2.0).

/**
 * Firma Ed25519 de paquetes `.sef`.
 *
 * Se firma un payload CANÓNICO con el hash SHA-256 del manifest y de cada
 * archivo del paquete (no el ZIP como blob: el orden/timestamps del zip no
 * importan). Agregar, quitar o modificar cualquier entrada invalida la firma.
 *
 * `signature.json` viaja dentro del `.sef` y contiene la clave pública para el
 * primer uso (TOFU). El IDE guarda la clave por id de extensión y exige la
 * misma en las actualizaciones.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject
} from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { unzipSync, zipSync } from 'fflate'
import { SEF } from './config.ts'

export const SIGNATURE_FILE = 'signature.json'
export const SIGNATURE_VERSION = 1
export const SIGNATURE_ALGORITHM = 'ed25519'

export interface SignatureFile {
  version: number
  algorithm: 'ed25519'
  /** `sha256:<32 hex>` derivado de la clave pública. */
  keyId: string
  /** SPKI DER en base64. */
  publicKey: string
  manifestSha256: string
  /** Ruta dentro del paquete → SHA-256 hex (excluye signature.json). */
  files: Record<string, string>
  /** Firma Ed25519 (base64) del payload canónico. */
  signature: string
}

export interface GeneratedKeyPair {
  privateKeyPath: string
  publicKeyPath: string
  keyId: string
}

export interface VerifyResult {
  ok: boolean
  keyId?: string
  publicKey?: string
  reason?: string
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/** `sha256:` + primeros 32 hex del DER de la clave pública. */
export function keyIdFor(publicKeyDer: Buffer): string {
  return `sha256:${sha256Hex(publicKeyDer).slice(0, 32)}`
}

function publicKeyDer(publicKey: KeyObject): Buffer {
  return publicKey.export({ type: 'spki', format: 'der' }) as Buffer
}

/** `createPublicKey` no acepta DER crudo: hay que envolverlo con format/type. */
function publicKeyFromDer(der: Buffer): KeyObject {
  return createPublicKey({ key: der, format: 'der', type: 'spki' })
}

/** Payload estable (claves de `files` ordenadas) que se firma/verifica. */
export function canonicalPayload(meta: {
  version: number
  algorithm: string
  keyId: string
  manifestSha256: string
  files: Record<string, string>
}): Buffer {
  const files = Object.fromEntries(
    Object.entries(meta.files).sort(([a], [b]) => a.localeCompare(b))
  )
  return Buffer.from(
    JSON.stringify({
      version: meta.version,
      algorithm: meta.algorithm,
      keyId: meta.keyId,
      manifestSha256: meta.manifestSha256,
      files
    }),
    'utf-8'
  )
}

/** Genera el par de claves. La privada queda con permisos 0600. */
export async function generateSigningKey(outDir: string): Promise<GeneratedKeyPair> {
  await fs.mkdir(outDir, { recursive: true })
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' })
  const der = publicKeyDer(publicKey)
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' })
  const privateKeyPath = path.join(outDir, 'sef-signing.key')
  const publicKeyPath = path.join(outDir, 'sef-signing.pub')
  await fs.writeFile(privateKeyPath, privatePem, { mode: 0o600 })
  await fs.writeFile(publicKeyPath, publicPem, { mode: 0o644 })
  await fs.chmod(privateKeyPath, 0o600).catch(() => undefined)
  return { privateKeyPath, publicKeyPath, keyId: keyIdFor(der) }
}

/** Firma el contenido que se va a zipear (sin incluir signature.json). */
export function createSignature(
  files: Record<string, Uint8Array>,
  privateKeyPem: string
): SignatureFile {
  const manifest = files[SEF.MANIFEST]
  if (!manifest) throw new Error(`${SEF.MANIFEST} no está en el paquete`)

  const hashes: Record<string, string> = {}
  for (const [name, data] of Object.entries(files)) {
    if (name === SIGNATURE_FILE) continue
    hashes[name] = sha256Hex(data)
  }

  const privateKey = createPrivateKey(privateKeyPem)
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('la clave de firma debe ser Ed25519')
  }
  const der = publicKeyDer(createPublicKey(privateKey))
  const keyId = keyIdFor(der)
  const meta = {
    version: SIGNATURE_VERSION,
    algorithm: SIGNATURE_ALGORITHM as 'ed25519',
    keyId,
    manifestSha256: hashes[SEF.MANIFEST]!,
    files: hashes
  }
  const signature = sign(null, canonicalPayload(meta), privateKey).toString('base64')
  return { ...meta, publicKey: der.toString('base64'), signature }
}

/**
 * Verifica un mapa de archivos (el contenido del `.sef`). Si se pasa
 * `trustedPublicKeyPem`, la clave del paquete tiene que coincidir.
 */
export function verifyFiles(
  files: Record<string, Uint8Array>,
  trustedPublicKeyPem?: string
): VerifyResult {
  const raw = files[SIGNATURE_FILE]
  if (!raw) return { ok: false, reason: 'el paquete no está firmado' }

  let sig: SignatureFile
  try {
    sig = JSON.parse(new TextDecoder().decode(raw)) as SignatureFile
  } catch {
    return { ok: false, reason: 'signature.json inválido' }
  }
  if (sig.version !== SIGNATURE_VERSION || sig.algorithm !== SIGNATURE_ALGORITHM) {
    return { ok: false, reason: 'versión/algoritmo de firma no soportado' }
  }
  if (typeof sig.publicKey !== 'string' || typeof sig.signature !== 'string') {
    return { ok: false, reason: 'firma incompleta' }
  }

  let der: Buffer
  let keyId: string
  try {
    der = Buffer.from(sig.publicKey, 'base64')
    if (der.length === 0) throw new Error('clave vacía')
    keyId = keyIdFor(der)
  } catch {
    return { ok: false, reason: 'clave pública inválida' }
  }
  if (keyId !== sig.keyId) return { ok: false, reason: 'keyId no coincide con la clave' }

  if (trustedPublicKeyPem) {
    const trusted = createPublicKey(trustedPublicKeyPem)
    const trustedDer = publicKeyDer(trusted)
    if (!trustedDer.equals(der)) {
      return { ok: false, keyId, publicKey: sig.publicKey, reason: 'clave no confiable' }
    }
  }

  // Recalcular TODOS los hashes del zip real (no confiar en sig.files).
  const actual: Record<string, string> = {}
  for (const [name, data] of Object.entries(files)) {
    if (name === SIGNATURE_FILE) continue
    actual[name] = sha256Hex(data)
  }
  const expected = sig.files ?? {}
  const names = new Set([...Object.keys(actual), ...Object.keys(expected)])
  for (const name of names) {
    if (actual[name] !== expected[name]) {
      return { ok: false, keyId, publicKey: sig.publicKey, reason: `archivo alterado: ${name}` }
    }
  }
  if (sig.manifestSha256 !== actual[SEF.MANIFEST]) {
    return { ok: false, keyId, publicKey: sig.publicKey, reason: 'manifest alterado' }
  }

  const meta = {
    version: sig.version,
    algorithm: sig.algorithm,
    keyId: sig.keyId,
    manifestSha256: sig.manifestSha256,
    files: actual
  }
  let ok = false
  try {
    ok = verify(
      null,
      canonicalPayload(meta),
      publicKeyFromDer(der),
      Buffer.from(sig.signature, 'base64')
    )
  } catch {
    return { ok: false, keyId, publicKey: sig.publicKey, reason: 'firma inválida' }
  }
  return ok
    ? { ok: true, keyId, publicKey: sig.publicKey }
    : { ok: false, keyId, publicKey: sig.publicKey, reason: 'firma no válida' }
}

/** Verifica un `.sef` en disco. */
export async function verifySefFile(
  sefPath: string,
  trustedPublicKeyPem?: string
): Promise<VerifyResult> {
  const files = unzipSync(new Uint8Array(await fs.readFile(sefPath)))
  return verifyFiles(files, trustedPublicKeyPem)
}

/** Firma un mapa de archivos y devuelve el zip listo para escribir. */
export function signAndZip(
  files: Record<string, Uint8Array>,
  privateKeyPem: string
): { zip: Uint8Array; signature: SignatureFile } {
  const signature = createSignature(files, privateKeyPem)
  const withSignature: Record<string, Uint8Array> = {
    ...files,
    [SIGNATURE_FILE]: new TextEncoder().encode(JSON.stringify(signature, null, 2) + '\n')
  }
  return { zip: zipSync(withSignature), signature }
}
