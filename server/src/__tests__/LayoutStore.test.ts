import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { LayoutStore } from '../LayoutStore.js'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

function validLayout(cols = 2, rows = 2): string {
  return JSON.stringify({
    version: 1,
    cols,
    rows,
    tiles: Array(cols * rows).fill(1),
    furniture: [],
  })
}

describe('LayoutStore', () => {
  let tmpDir: string
  let store: LayoutStore

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-test-'))
    store = new LayoutStore(tmpDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('starts with empty JSON', () => {
    expect(store.getJson()).toBe('{}')
    expect(store.getEtag()).toBe('')
  })

  it('loads layout from disk', () => {
    const layoutFile = path.join(tmpDir, 'layout.json')
    fs.writeFileSync(layoutFile, validLayout())
    store.load()
    expect(JSON.parse(store.getJson()).version).toBe(1)
    expect(store.getEtag()).not.toBe('')
  })

  it('saves layout to disk atomically', () => {
    const json = validLayout()
    store.update(json)
    const layoutFile = path.join(tmpDir, 'layout.json')
    expect(fs.existsSync(layoutFile)).toBe(true)
    expect(fs.readFileSync(layoutFile, 'utf-8')).toBe(json)
  })

  it('computes new etag on update', () => {
    store.update(validLayout(2, 2))
    const etag1 = store.getEtag()
    store.update(validLayout(3, 3))
    const etag2 = store.getEtag()
    expect(etag1).not.toBe(etag2)
  })

  it('creates data dir if it does not exist', () => {
    const nested = path.join(tmpDir, 'sub', 'dir')
    const s2 = new LayoutStore(nested)
    s2.update(validLayout())
    expect(fs.existsSync(path.join(nested, 'layout.json'))).toBe(true)
  })

  it('rejects invalid JSON', () => {
    expect(() => store.update('not json')).toThrow()
  })

  // ── Validation tests ──

  it('rejects layout without version', () => {
    expect(() => store.update('{"cols":2,"rows":2,"tiles":[1,1,1,1],"furniture":[]}')).toThrow(/version/)
  })

  it('rejects layout with wrong version', () => {
    expect(() => store.update('{"version":2,"cols":2,"rows":2,"tiles":[1,1,1,1],"furniture":[]}')).toThrow(/version/)
  })

  it('rejects layout with mismatched tiles length', () => {
    const bad = JSON.stringify({ version: 1, cols: 3, rows: 3, tiles: [1, 1], furniture: [] })
    expect(() => store.update(bad)).toThrow(/tiles length/)
  })

  it('rejects layout without furniture array', () => {
    const bad = JSON.stringify({ version: 1, cols: 2, rows: 2, tiles: [1, 1, 1, 1] })
    expect(() => store.update(bad)).toThrow(/furniture/)
  })

  it('rejects layout with non-integer dimensions', () => {
    const bad = JSON.stringify({ version: 1, cols: 2.5, rows: 2, tiles: [1, 1, 1, 1, 1], furniture: [] })
    expect(() => store.update(bad)).toThrow(/dimensions/)
  })

  // ── Backup tests ──

  it('creates backup on update', () => {
    const layoutFile = path.join(tmpDir, 'layout.json')
    fs.writeFileSync(layoutFile, validLayout(2, 2))
    store.load()

    store.update(validLayout(3, 3))
    const backup = `${layoutFile}.backup.1`
    expect(fs.existsSync(backup)).toBe(true)
    expect(JSON.parse(fs.readFileSync(backup, 'utf-8')).cols).toBe(2)
  })

  it('rotates backups up to 5', () => {
    const layoutFile = path.join(tmpDir, 'layout.json')
    fs.writeFileSync(layoutFile, validLayout(1, 1))
    store.load()

    for (let i = 2; i <= 8; i++) {
      store.update(validLayout(i, i))
    }

    // Should have backups 1-5, not 6+
    for (let i = 1; i <= 5; i++) {
      expect(fs.existsSync(`${layoutFile}.backup.${i}`)).toBe(true)
    }
    expect(fs.existsSync(`${layoutFile}.backup.6`)).toBe(false)

    // Backup 1 should be the most recent (cols=7), backup 5 the oldest (cols=3)
    expect(JSON.parse(fs.readFileSync(`${layoutFile}.backup.1`, 'utf-8')).cols).toBe(7)
    expect(JSON.parse(fs.readFileSync(`${layoutFile}.backup.5`, 'utf-8')).cols).toBe(3)
  })

  it('does not create backup on first save (no previous file)', () => {
    store.update(validLayout())
    const backup = path.join(tmpDir, 'layout.json.backup.1')
    expect(fs.existsSync(backup)).toBe(false)
  })
})
