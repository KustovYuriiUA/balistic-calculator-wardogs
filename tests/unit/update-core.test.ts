import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  chooseEntry,
  isNewer,
  parseVersion,
  readState,
  readZip,
  safeEntry,
  validateManifest,
  writeState,
} from '@/features/updates/main/update-core'

import { listFiles, writeZip } from '../../scripts/zip.cjs'

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'shot-update-'))

describe('update core', () => {
  it('versions: tags with or without v, numeric order, invalid input never counts as newer', () => {
    expect(parseVersion('v1.10.2')).toEqual([1, 10, 2])
    expect(isNewer('1.10.0', '1.9.9')).toBe(true)
    expect(isNewer('v2.0.0', '1.99.99')).toBe(true)
    const same = [['1.0.0', '1.0.0'], ['1.0.0', '1.0.1'], ['latest', '1.0.0'], ['1.0', '0.9.0'], ['1.0.0-beta', '0.9.0']]
    for (const [a, b] of same) expect(isNewer(a, b), a + ' vs ' + b).toBe(false)
  })

  it('manifest needs version, Electron version and both assets with size and SHA-256', () => {
    const asset = {
      name: 'app-1.1.0.zip',
      size: 10,
      sha256: 'a'.repeat(64),
    }
    const good = {
      version: '1.1.0',
      electron: '44.3.0',
      app: asset,
      full: {
        ...asset,
        name: 'full.zip',
      },
    }
    expect(validateManifest(good)).toBe(good)
    const bad = [
      null,
      {
        ...good,
        version: 'x',
      },
      {
        ...good,
        electron: '',
      },
      {
        ...good,
        app: {
          ...asset,
          sha256: 'zz',
        },
      },
      {
        ...good,
        full: {
          ...asset,
          name: '../x',
        },
      },
      {
        ...good,
        app: {
          ...asset,
          size: 0,
        },
      },
    ]
    for (const manifest of bad) expect(() => validateManifest(manifest)).toThrow()
  })

  it('ZIP round trip: deflated and stored entries, Cyrillic names, nested folders', () => {
    const dir = temp()
    const src = path.join(dir, 'src')
    fs.mkdirSync(path.join(src, 'dist', 'maps'), {
      recursive: true,
    })
    fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({
      version: '1.2.3',
    }))
    fs.writeFileSync(path.join(src, 'dist', 'maps', 'карта.webp'), Buffer.from([1, 2, 3]))
    fs.writeFileSync(path.join(src, 'dist', 'index.html'), '<p>' + 'повтор '.repeat(500) + '</p>')
    const zip = path.join(dir, 'out.zip')
    writeZip(zip, listFiles(src, 'root/'))
    const files = readZip(fs.readFileSync(zip))
    expect(files.map((f) => f.name)).toEqual(['root/dist/index.html', 'root/dist/maps/карта.webp', 'root/package.json'])
    expect(files[0].data.toString()).toBe(fs.readFileSync(path.join(src, 'dist', 'index.html'), 'utf8'))
    expect([...files[1].data]).toEqual([1, 2, 3])
  })

  it('ZIP reader rejects escaping paths and corrupted data', () => {
    for (const name of ['../evil.js', '/abs.js', 'C:/x.js', 'a\\b.js', 'a/../b.js', 'a//b.js']) {
      expect(safeEntry(name), name).toBe(false)
    }
    const dir = temp()
    const file = path.join(dir, 'f.txt')
    fs.writeFileSync(file, 'x'.repeat(1000))
    const zip = path.join(dir, 'evil.zip')
    writeZip(zip, [{
      full: file,
      name: '../evil.js',
    }])
    expect(() => readZip(fs.readFileSync(zip))).toThrow(/Invalid path/)
    writeZip(zip, [{
      full: file,
      name: 'ok.txt',
    }])
    const broken = fs.readFileSync(zip)
    broken[40] ^= 0xff
    expect(() => readZip(broken)).toThrow()
  })

  it('boot picks a newer staged update, retries an unconfirmed start once, then falls back', () => {
    const userData = temp()
    const bundled = temp()
    fs.mkdirSync(path.join(bundled, 'desktop'))
    fs.writeFileSync(path.join(bundled, 'package.json'), JSON.stringify({
      version: '1.0.0',
    }))
    const bundledEntry = path.join(bundled, 'desktop', 'main.cjs')
    const updateEntry = path.join(userData, 'updates', '1.1.0', 'desktop', 'main.cjs')
    expect(chooseEntry(userData, bundled), 'nothing staged').toBe(bundledEntry)
    fs.mkdirSync(path.dirname(updateEntry), {
      recursive: true,
    })
    fs.writeFileSync(updateEntry, '')
    writeState(userData, {
      version: '1.1.0',
      attempts: 0,
      isConfirmed: false,
    })
    expect(chooseEntry(userData, bundled), 'first start of the update').toBe(updateEntry)
    expect(chooseEntry(userData, bundled), 'one retry').toBe(updateEntry)
    expect(chooseEntry(userData, bundled), 'third unconfirmed start falls back').toBe(bundledEntry)
    expect(readState(userData)?.isBroken).toBe(true)
    writeState(userData, {
      version: '1.1.0',
      attempts: 5,
      isConfirmed: true,
    })
    expect(chooseEntry(userData, bundled), 'a confirmed update keeps starting').toBe(updateEntry)
    writeState(userData, {
      version: '0.9.0',
      attempts: 0,
      isConfirmed: true,
    })
    expect(chooseEntry(userData, bundled), 'an older staged version never replaces a newer app').toBe(bundledEntry)
  })

  it('the state file keeps 1.x field names: old copies read it', () => {
    const userData = temp()
    writeState(userData, {
      version: '1.1.0',
      attempts: 1,
      isConfirmed: true,
    })
    const file = JSON.parse(fs.readFileSync(path.join(userData, 'updates', 'state.json'), 'utf8'))
    expect(file).toMatchObject({
      version: '1.1.0',
      attempts: 1,
      confirmed: true,
    })
  })
})
