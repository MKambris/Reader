import 'fake-indexeddb/auto'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { Library, resolvePosition } from '../src/library/store'
import { UnsupportedTypeError } from '../src/doc/errors'
import { PARSER_VERSION, type Doc } from '../src/doc/types'

// fake-indexeddb clones with Node's structuredClone, which can't clone jsdom's Blob/File
// (a real browser can). Use Node's own Blob/File so stored files round-trip like in Chrome.
Object.assign(globalThis, { Blob: NodeBlob, File: NodeFile })

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
    const stale: Doc = { title: 'stale', sections: [{ title: 'x', blocks: [{ id: 'old', kind: 'text', text: 'old' }] }] }
    await lib.putCachedDoc(id, stale, PARSER_VERSION - 1)
    const doc = await lib.loadDoc(id)
    expect(doc.title).not.toBe('stale')
    expect(await lib.cachedParserVersion(id)).toBe(PARSER_VERSION)
  })

  it('AC9: a book cached by parser v1 keeps its saved text position after re-parse', async () => {
    const { id } = await lib.importFile(load('book.epub'))
    const snap = JSON.parse(readFileSync(join(__dirname, 'snapshots', 'text-blocks-v1.json'), 'utf8'))['book.epub']
    const v1: Doc = { title: 'Fixture Book', sections: [{ title: 'x', blocks: snap.map(([bid, text]: [string, string]) => ({ id: bid, kind: 'text', text })) }] }
    await lib.putCachedDoc(id, v1, 1)
    await lib.savePosition(id, { blockId: 's1b3', fraction: 0.4 })
    const doc = await lib.loadDoc(id)
    expect(doc.sections.some(s => s.blocks.some(b => b.kind === 'image'))).toBe(true)
    expect(resolvePosition(doc, await lib.getPosition(id))).toBe('s1b3')
  })

  it('falls back to fraction when the saved blockId no longer exists', () => {
    const doc: Doc = {
      title: 't',
      sections: [{ title: 'a', blocks: Array.from({ length: 10 }, (_, i) => ({ id: `s0b${i}`, kind: 'text' as const, text: `p${i}` })) }],
    }
    expect(resolvePosition(doc, { blockId: 's0b4', fraction: 0.9 })).toBe('s0b4')
    expect(resolvePosition(doc, { blockId: 'gone', fraction: 0.5 })).toBe('s0b5')
    expect(resolvePosition(doc, { blockId: 'gone', fraction: 1 })).toBe('s0b9')
    expect(resolvePosition(doc, undefined)).toBe('s0b0')
  })
})
