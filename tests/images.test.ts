import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDocument } from '../src/doc/openDocument'
import type { Doc } from '../src/doc/types'

const FIX = join(__dirname, 'fixtures')
const load = (name: string) => new File([readFileSync(join(FIX, name))], name)
const flat = (d: Doc) => d.sections.flatMap(s => s.blocks)
const images = (d: Doc) => flat(d).flatMap(b => (b.kind === 'image' ? [b] : []))
/** Index of the first block whose text includes `needle`. */
const at = (d: Doc, needle: string) => flat(d).findIndex(b => b.kind === 'text' && b.text.includes(needle))

describe('AC1 book illustration', () => {
  it.each(['book.epub', 'book.mobi', 'book.azw3', 'book.fb2', 'book.docx'])('%s', async name => {
    const doc = await openDocument(load(name))
    const imgs = images(doc)
    expect(imgs).toHaveLength(1)
    expect(imgs[0].blob.type).toMatch(/^image\//)
    expect(imgs[0].blob.size).toBeGreaterThan(512)
    expect(imgs[0].id).toMatch(/^s\d+i0$/)
    const i = flat(doc).indexOf(imgs[0])
    expect(i).toBeGreaterThan(at(doc, 'striking thirteen'))
    expect(i).toBeLessThan(at(doc, 'boiled cabbage'))
  })
})

describe('AC2/AC3 article photo, spacer skipped', () => {
  it.each(['article.html', 'article.mhtml'])('%s', async name => {
    const doc = await openDocument(load(name))
    const imgs = images(doc)
    expect(imgs).toHaveLength(1)
    expect(imgs[0].alt).toBe('A chart of recall scores')
    expect(imgs[0].blob.type).toBe('image/png')
    const i = flat(doc).indexOf(imgs[0])
    expect(i).toBeGreaterThan(at(doc, 'six months'))
    expect(i).toBeLessThan(at(doc, 'remembered noticeably more'))
  })
})

describe('AC4 text block ids unchanged from spec 01 parser', () => {
  const snap: Record<string, [string, string][]> = JSON.parse(
    readFileSync(join(__dirname, 'snapshots', 'text-blocks-v1.json'), 'utf8'))
  it.each(Object.keys(snap))('%s', async name => {
    const doc = await openDocument(load(name))
    const text = flat(doc).flatMap(b => (b.kind === 'text' ? [[b.id, b.text]] : []))
    expect(text).toEqual(snap[name])
  })
})

describe('AC6 SVG scripts never run', () => {
  it('svg-script.epub yields SVG image blocks and runs nothing', async () => {
    const doc = await openDocument(load('svg-script.epub'))
    const svgs = images(doc).filter(b => b.blob.type === 'image/svg+xml')
    expect(svgs.length).toBe(2) // <img>-referenced and inline
    expect((globalThis as any).__pwned).toBeUndefined()
  })
})

describe('AC11 image spine items become image blocks', () => {
  it('ruby-jpeg-spine.epub turns JPEG and SVG pages into image blocks', async () => {
    const doc = await openDocument(load('ruby-jpeg-spine.epub'))
    expect(images(doc).some(b => b.blob.type === 'image/jpeg')).toBe(true)
    // The SVG page has a 1.2 KB comment before <svg>, so type sniffing must look past 64 bytes.
    expect(images(doc).some(b => b.blob.type === 'image/svg+xml')).toBe(true)
  })
})

describe('AC12 progress', () => {
  it('reports rising progress ending at 1', async () => {
    const seen: number[] = []
    await openDocument(load('long.pdf'), { onProgress: f => seen.push(f) })
    expect(seen.length).toBeGreaterThan(3)
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
    expect(seen.at(-1)).toBe(1)
  })
})
