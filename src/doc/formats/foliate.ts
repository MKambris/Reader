import { domToSection } from '../blocks'
import { isEpubDrm, isMobiDrm } from '../drm'
import { DrmError, UnsupportedTypeError } from '../errors'
import type { Parsed, RawSection } from '../types'

const pickLang = (v: unknown): string | undefined => {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.name !== 'undefined') return pickLang(o.name)
    const first = Object.values(o)[0]
    return typeof first === 'string' ? first : undefined
  }
  return undefined
}

const authorOf = (v: unknown): string | undefined => {
  const list = Array.isArray(v) ? v : v ? [v] : []
  const names = list.map(pickLang).filter((s): s is string => !!s?.trim())
  return names.length ? names.join(', ') : undefined
}

async function fromBook(book: FoliateBook): Promise<Parsed> {
  const sections: RawSection[] = []
  for (const s of book.sections) {
    if (!s.createDocument) continue
    const doc = await s.createDocument()
    sections.push(domToSection(doc.body ?? doc.documentElement))
  }
  return {
    title: pickLang(book.metadata?.title)?.trim() || undefined,
    author: authorOf(book.metadata?.author),
    sections,
  }
}

async function zipLoader(file: Blob) {
  const { configure, ZipReader, BlobReader, TextWriter, BlobWriter } =
    await import('../../../vendor/foliate-js/vendor/zip.js')
  configure({ useWebWorkers: false })
  const entries = await new ZipReader(new BlobReader(file)).getEntries()
  const map = new Map(entries.map((e: any) => [e.filename, e]))
  const load = (f: (e: any, ...a: any[]) => unknown) => (name: string, ...a: any[]) =>
    map.has(name) ? f(map.get(name), ...a) : null
  return {
    entries,
    has: (name: string) => map.has(name),
    loadText: load(e => e.getData(new TextWriter())) as (n: string) => Promise<string> | null,
    loadBlob: load((e, type) => e.getData(new BlobWriter(type))),
    getSize: (name: string) => map.get(name)?.uncompressedSize ?? 0,
  }
}

export async function parseEpub(file: Blob): Promise<Parsed> {
  const loader = await zipLoader(file)
  const enc = await loader.loadText('META-INF/encryption.xml')
  if (isEpubDrm(enc, loader.has('META-INF/rights.xml'))) throw new DrmError()
  const { EPUB } = await import('../../../vendor/foliate-js/epub.js')
  return fromBook(await new EPUB(loader).init())
}

export async function parseMobi(file: Blob): Promise<Parsed> {
  const { MOBI, isMOBI } = await import('../../../vendor/foliate-js/mobi.js')
  // Old PalmDOC-only files (TEXtREAd) aren't readable by foliate-js.
  if (!(await isMOBI(file))) throw new UnsupportedTypeError('mobi (old PalmDOC format)')
  if (await isMobiDrm(file)) throw new DrmError()
  const { unzlibSync } = await import('../../../vendor/foliate-js/vendor/fflate.js')
  return fromBook(await new MOBI({ unzlib: unzlibSync }).open(file))
}

export async function parseFb2(file: Blob, zipped: boolean): Promise<Parsed> {
  const { makeFB2 } = await import('../../../vendor/foliate-js/fb2.js')
  let blob = file
  if (zipped) {
    const loader = await zipLoader(file)
    const entry = loader.entries.find((e: any) => e.filename.endsWith('.fb2')) ?? loader.entries[0]
    blob = (await loader.loadBlob(entry.filename)) as Blob
  }
  return fromBook(await makeFB2(blob))
}
