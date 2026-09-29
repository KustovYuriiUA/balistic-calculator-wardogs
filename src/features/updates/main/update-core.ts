import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

import { t } from '@/shared/i18n'

// No Electron here: boot runs this before anything else, and it must never break on a bad update.

export type Version = [number, number, number]

export function parseVersion(text: unknown): Version | null {
  const match = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(String(text).trim())
  return match ? match.slice(1).map(Number) as Version : null
}

export function isNewer(candidate: unknown, current: unknown): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

export interface ManifestAsset {
  name: string
  size: number
  sha256: string
}

/** update.json of a release: the app bundle and the full download, and the Electron runtime they need. */
export interface Manifest {
  version: string
  electron: string
  app: ManifestAsset
  full: ManifestAsset
}

const SHA256 = /^[0-9a-f]{64}$/
const ASSET_NAME = /^[\w.-]{1,120}$/

export function validateManifest(manifest: unknown): Manifest {
  const m = manifest as Partial<Manifest> | null
  const isAsset = (a: Partial<ManifestAsset> | undefined) => Boolean(a
    && typeof a.name === 'string' && ASSET_NAME.test(a.name)
    && Number.isSafeInteger(a.size) && (a.size as number) > 0
    && typeof a.sha256 === 'string' && SHA256.test(a.sha256))
  const isValid = Boolean(m && typeof m === 'object'
    && parseVersion(m.version)
    && typeof m.electron === 'string' && parseVersion(m.electron)
    && isAsset(m.app) && isAsset(m.full))
  if (!isValid) throw new Error(t('upd.err.manifest'))
  return m as Manifest
}

export function safeEntry(name: string): boolean {
  return name.length > 0 && name.length < 260
    && !name.includes('\\') && !name.startsWith('/') && !/^[a-z]:/i.test(name)
    && name.split('/').every((part) => part && part !== '.' && part !== '..')
}

export interface ZipEntry {
  name: string
  data: Buffer
}

/** Our own archives only: stored or deflated entries, UTF-8 names, CRC-checked. */
export function readZip(buffer: Buffer): ZipEntry[] {
  let end = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error(t('upd.err.zip'))
  const count = buffer.readUInt16LE(end + 10)
  let offset = buffer.readUInt32LE(end + 16)
  const files: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error(t('upd.err.zip'))
    const method = buffer.readUInt16LE(offset + 10)
    const crc = buffer.readUInt32LE(offset + 16)
    const compressed = buffer.readUInt32LE(offset + 20)
    const size = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const local = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    offset += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue
    if (!safeEntry(name)) {
      throw new Error(t('upd.err.path', {
        name,
      }))
    }
    if (buffer.readUInt32LE(local) !== 0x04034b50) throw new Error(t('upd.err.zip'))
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28)
    const raw = buffer.subarray(start, start + compressed)
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null
    if (!data || data.length !== size || zlib.crc32(data) !== crc) {
      throw new Error(t('upd.err.file', {
        name,
      }))
    }
    files.push({
      name,
      data,
    })
  }
  return files
}

/** state.json in <userData>/updates: the update to start next and how its starts went. */
export interface UpdateStartState {
  version: string
  attempts: number
  isConfirmed: boolean
  isBroken?: boolean
}

export const updatesDir = (userData: string) => path.join(userData, 'updates')

// On disk the file keeps the field names of 1.x ({version, attempts, confirmed, broken}): installed copies' boot
// reads it before starting an update.
export function readState(userData: string): UpdateStartState | null {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(updatesDir(userData), 'state.json'), 'utf8'))
    if (typeof s?.version !== 'string') return null
    return {
      version: s.version,
      attempts: Number.isSafeInteger(s.attempts) ? s.attempts : 0,
      isConfirmed: s.confirmed === true,
      isBroken: s.broken === true,
    }
  } catch {
    return null
  }
}

export function writeState(userData: string, state: UpdateStartState) {
  const dir = updatesDir(userData)
  const temporary = path.join(dir, 'state.json.tmp')
  fs.mkdirSync(dir, {
    recursive: true,
  })
  const onDisk = {
    version: state.version,
    attempts: state.attempts,
    confirmed: state.isConfirmed,
    ...(state.isBroken ? {
      broken: true,
    } : {}),
  }
  fs.writeFileSync(temporary, JSON.stringify(onDisk))
  fs.renameSync(temporary, path.join(dir, 'state.json'))
}

// An update that never confirmed a successful start gets one retry, then the bundled app starts again and the
// update is marked broken.
/** The main entry to start: the newest downloaded update, or the bundled app. */
export function chooseEntry(userData: string, bundledRoot: string): string {
  const bundled = path.join(bundledRoot, 'desktop', 'main.cjs')
  try {
    const state = readState(userData)
    const bundledVersion = JSON.parse(fs.readFileSync(path.join(bundledRoot, 'package.json'), 'utf8')).version
    if (!state || state.isBroken || !isNewer(state.version, bundledVersion)) return bundled
    const entry = path.join(updatesDir(userData), state.version, 'desktop', 'main.cjs')
    if (!fs.existsSync(entry)) return bundled
    if (!state.isConfirmed) {
      if (state.attempts >= 2) {
        writeState(userData, {
          ...state,
          isBroken: true,
        })
        return bundled
      }
      writeState(userData, {
        ...state,
        attempts: state.attempts + 1,
      })
    }
    return entry
  } catch {
    return bundled
  }
}
