import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDocument } from '../src/doc/openDocument'
import { DrmError, UnsupportedTypeError } from '../src/doc/errors'

const FIX = join(__dirname, 'fixtures')
const load = (name: string) => new File([readFileSync(join(FIX, name))], name)
type D = Awaited<ReturnType<typeof openDocument>>
const textBlocks = (d: D) => d.sections.flatMap(s => s.blocks).flatMap(b => (b.kind === 'text' ? [b] : []))
const allText = (d: D) => textBlocks(d).map(b => b.text).join('\n')

const BOOKS = ['book.epub', 'book.mobi', 'book.azw3', 'book.fb2', 'book.pdf', 'book.docx', 'book.txt']
const ARTICLES = ['article.html', 'article.mhtml']

describe('openDocument — AC1 every format yields a Doc', () => {
  it.each([...BOOKS, ...ARTICLES])('%s', async name => {
    const doc = await openDocument(load(name))
    expect(doc.title.trim()).not.toBe('')
    const blocks = textBlocks(doc)
    expect(blocks.length).toBeGreaterThan(0)
    for (const b of blocks) {
      expect(b.text).not.toMatch(/<[a-z/!][^>]*>/i)
      expect(b.text.trim()).not.toBe('')
    }
  })

  it.each(BOOKS)('%s contains the book body text', async name => {
    const text = allText(await openDocument(load(name)))
    expect(text).toContain('the clocks were striking thirteen')
    expect(text).toContain('A final paragraph closes the book.')
  })

  it.each(['book.epub', 'book.mobi', 'book.azw3', 'book.fb2', 'book.pdf'])(
    '%s reads title metadata', async name => {
      expect((await openDocument(load(name))).title).toBe('Fixture Book')
    })

  it.each(['book.epub', 'book.azw3', 'book.fb2', 'book.pdf'])('%s reads author', async name => {
    expect((await openDocument(load(name))).author).toBe('Test Author')
  })
})

describe('AC2 stable block ids', () => {
  it.each([...BOOKS, ...ARTICLES])('%s', async name => {
    const ids = async () => (await openDocument(load(name))).sections.flatMap(s => s.blocks.map(b => b.id))
    const a = await ids()
    expect(a).toEqual(await ids())
    expect(new Set(a).size).toBe(a.length)
  })
})

describe('AC3 DRM', () => {
  it.each(['drm.epub', 'drm.mobi'])('%s rejects with DrmError', async name => {
    await expect(openDocument(load(name))).rejects.toBeInstanceOf(DrmError)
  })
})

// Spec 01 AC4 (scanned PDFs rejected) is superseded by spec 01c: see arabicPdf.test.ts.

describe('AC5 article extraction', () => {
  it.each(ARTICLES)('%s keeps body, drops chrome', async name => {
    const doc = await openDocument(load(name))
    const text = allText(doc)
    expect(doc.title).toBe('Reading Aloud Helps, Study Finds')
    expect(text).toContain('reading aloud improves comprehension')
    expect(text).toContain('between kinds of material')
    for (const junk of ['Subscribe now', 'Privacy policy', 'Terms of service', 'Contact us', 'Technology']) {
      expect(text).not.toContain(junk)
    }
  })

  it('MHTML matches HTML and has no quoted-printable artifacts', async () => {
    const html = allText(await openDocument(load('article.html')))
    const mhtml = allText(await openDocument(load('article.mhtml')))
    expect(mhtml).toBe(html)
    expect(mhtml).not.toMatch(/=20|=\n|=3D/)
  })
})

describe('AC13 embedded scripts never run', () => {
  it('script.epub opens and does not execute its script', async () => {
    const doc = await openDocument(load('script.epub'))
    expect(allText(doc)).toContain('the clocks were striking thirteen')
    expect(allText(doc)).not.toContain('__pwned')
    expect((globalThis as any).__pwned).toBeUndefined()
  })
})

describe('unsupported types', () => {
  it('rejects unknown extensions with UnsupportedTypeError', async () => {
    await expect(openDocument(new File(['x'], 'thing.xyz'))).rejects.toBeInstanceOf(UnsupportedTypeError)
  })
})

describe('real-world EPUB quirks (IDPF epub3-samples)', () => {
  it('skips a JPEG spine item and drops ruby annotations', async () => {
    const text = allText(await openDocument(load('ruby-jpeg-spine.epub')))
    expect(text).toContain('the clocks were striking thirteen')
    expect(text).toContain('山路を登りながら、漢字。')
    expect(text).not.toMatch(/やまみち|かん|\(|\)/)
  })
})
