import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { Library, resolvePosition } from '../src/library/store'
import { UnsupportedTypeError } from '../src/doc/errors'
import { PARSER_VERSION, type Doc } from '../src/doc/types'

const load = (name: string) => new File([readFileSync(join(__dirname, 'fixtures', name))], name)
let lib: Library
let n = 0
beforeEach(async () => { lib = await Library.open(`test-${n++}`) })

describe('import (AC6)', () => {
  it('adds a supported file with title and author', async () => {
    const meta = await lib.importFile(load('book.epub'))
    expect(meta).toMatchObject({ title: 'Fixture Book', author: 'Test Author' })
    expect((await lib.listBooks()).map(b => b.id)).toEqual([meta.id])
  })
  it('rejects an unsupported file and adds nothing', async () => {
    await expect(lib.importFile(new File(['x'], 'notes.xyz'))).rejects.toThrow('Unsupported file type: .xyz')
    await expect(lib.importFile(new File(['x'], 'notes.xyz'))).rejects.toBeInstanceOf(UnsupportedTypeError)
    expect(await lib.listBooks()).toEqual([])
  })
  it('adds nothing when parsing fails (DRM)', async () => {
    await expect(lib.importFile(load('drm.epub'))).rejects.toThrow('DRM')
    expect(await lib.listBooks()).toEqual([])
  })
})

describe('position (AC7)', () => {
  it('round-trips the saved position', async () => {
    const { id } = await lib.importFile(load('book.txt'))
    await lib.savePosition(id, { blockId: 's0b3', fraction: 0.5 })
    expect(await lib.getPosition(id)).toEqual({ blockId: 's0b3', fraction: 0.5 })
  })
})

describe('delete (AC8)', () => {
  it('removes book, file, doc and position records', async () => {
    const { id } = await lib.importFile(load('book.txt'))
    await lib.savePosition(id, { blockId: 's0b1', fraction: 0.1 })
    await lib.deleteBook(id)
    const reopened = await Library.open(lib.name)
    expect(await reopened.listBooks()).toEqual([])
    expect(await reopened.rawCounts(id)).toEqual({ books: 0, files: 0, docs: 0, positions: 0 })
  })
})

describe('parser version (AC12)', () => {
  it('re-parses when the cached doc is from an older parser', async () => {
    const { id } = await lib.importFile(load('book.txt'))
    const stale: Doc = { title: 'stale', sections: [{ title: 'x', blocks: [{ id: 'old', text: 'old' }] }] }
    await lib.putCachedDoc(id, stale, PARSER_VERSION - 1)
    const doc = await lib.loadDoc(id)
    expect(doc.title).not.toBe('stale')
    expect(await lib.cachedParserVersion(id)).toBe(PARSER_VERSION)
  })

  it('falls back to fraction when the saved blockId no longer exists', () => {
    const doc: Doc = {
      title: 't',
      sections: [{ title: 'a', blocks: Array.from({ length: 10 }, (_, i) => ({ id: `s0b${i}`, text: `p${i}` })) }],
    }
    expect(resolvePosition(doc, { blockId: 's0b4', fraction: 0.9 })).toBe('s0b4')
    expect(resolvePosition(doc, { blockId: 'gone', fraction: 0.5 })).toBe('s0b5')
    expect(resolvePosition(doc, { blockId: 'gone', fraction: 1 })).toBe('s0b9')
    expect(resolvePosition(doc, undefined)).toBe('s0b0')
  })
})
