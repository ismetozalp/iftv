// Encrypted backup envelope — PBKDF2(SHA-256) → AES-256-GCM, via globalThis.crypto.subtle.
// Pure: no cockpit/DOM. Works identically in the Cockpit iframe and the node/vitest test env.
// NEVER log passwords/keys/plaintext.

const PBKDF2_ITERATIONS = 600000
const SALT_BYTES = 16
const IV_BYTES = 12
const CHUNK_SIZE = 0x8000 // avoid String.fromCharCode(...bytes) stack overflow on large inputs

const enc = new TextEncoder()
const dec = new TextDecoder()

interface EncEnvelope {
  app: 'inflighttv'
  kind: 'backup-enc'
  v: 1
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string }
  cipher: 'AES-GCM'
  salt: string
  iv: string
  ct: string
}

function b64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE))
  }
  return btoa(s)
}

function unb64(s: string): Uint8Array {
  const bin = atob(s)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await globalThis.crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ])
  return globalThis.crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encryptBackup(plaintext: string, password: string): Promise<string> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS)
  const ct = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext))
  const envelope: EncEnvelope = {
    app: 'inflighttv',
    kind: 'backup-enc',
    v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: b64(salt) },
    cipher: 'AES-GCM',
    salt: b64(salt),
    iv: b64(iv),
    ct: b64(new Uint8Array(ct)),
  }
  return JSON.stringify(envelope)
}

export async function decryptBackup(envelopeJson: string, password: string): Promise<string> {
  let env: any
  try {
    env = JSON.parse(envelopeJson)
  } catch {
    throw new Error('Not a valid backup file')
  }
  if (!env || env.kind !== 'backup-enc' || env.v !== 1) {
    throw new Error('Not a valid backup file')
  }
  const salt = unb64(env.kdf.salt)
  const iv = unb64(env.iv)
  const key = await deriveKey(password, salt, env.kdf.iterations)
  const pt = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    unb64(env.ct) as BufferSource
  )
  return dec.decode(pt)
}
