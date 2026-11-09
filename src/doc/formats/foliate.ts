import { domToSection } from '../blocks'
import { makeYielder, noExternalImages, resolveSection } from '../images'
import { isEpubDrm, isMobiDrm } from '../drm'
import { DrmError, UnsupportedTypeError } from '../errors'
import type { ImageResolver, OpenOptions, Parsed, ParsedSection } from '../types'

type FSection = FoliateBook['sections'][number]
interface ImageAccess {
  /** Resolve an image src found inside `section`. */
  resolverFor: (section: FSection) => ImageResolver
  /** Raw bytes of a spine item that isn't markup (e.g. a JPEG page), if available. */
  sectionBlob?: (section: FSection) => Promise<Blob | null>
}

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

async function fromBook(book: FoliateBook, access: ImageAccess, opts: OpenOptions): Promise<Parsed> {
  const sections: ParsedSection[] = []
  const yieldNow = makeYielder()
  const n = book.sections.length
  for (const [i, s] of book.sections.entries()) {
    // Keep one entry per spine item so section indices (and block ids) stay stable.
    sections.push(await readSection(s, access))
    opts.onProgress?.((i + 1) / n)
    await yieldNow()
  }
  if (!n) opts.onProgress?.(1)
  return {
    title: pickLang(book.metadata?.title)?.trim() || undefined,
    author: authorOf(book.metadata?.author),
    sections,
  }
}

async function readSection(s: FSection, access: ImageAccess): Promise<ParsedSection> {
  if (!s.createDocument) return { items: [] }
  try {
    const doc = await s.createDocument()
    return await resolveSection(domToSection(doc.body ?? doc.documentElement), access.resolverFor(s))
  } catch {
    // Non-markup spine item (e.g. a JPEG page in a manga EPUB): show it as a picture.
    const blob = await access.sectionBlob?.(s).catch(() => null)
    if (!blob) return { items: [] }
    return resolveSection({ items: [{ kind: 'blob', blob, alt: '' }] }, noExternalImages)
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

export async function parseEpub(file: Blob, opts: OpenOptions = {}): Promise<Parsed> {
  const loader = await zipLoader(file)
  const enc = await loader.loadText('META-INF/encryption.xml')
  if (isEpubDrm(enc, loader.has('META-INF/rights.xml'))) throw new DrmError()
  const { EPUB } = await import('../../../vendor/foliate-js/epub.js')
  const loadPath = async (path: string): Promise<Blob | null> => {
    for (const p of [path, safeDecode(path)]) {
      const b = await loader.loadBlob(p)
      if (b) return b as Blob
    }
    return null
  }
  return fromBook(await new EPUB(loader).init(), {
    resolverFor: s => src => loadPath(s.resolveHref ? s.resolveHref(src.split('#')[0]) : src),
    sectionBlob: s => (typeof s.id === 'string' ? loadPath(s.id) : Promise.resolve(null)),
  }, opts)
}

const safeDecode = (s: string) => {
  try { return decodeURIComponent(s) } catch { return s }
}

export async function parseMobi(file: Blob, opts: OpenOptions = {}): Promise<Parsed> {
  const { MOBI, isMOBI } = await import('../../../vendor/foliate-js/mobi.js')
  // Old PalmDOC-only files (TEXtREAd) aren't readable by foliate-js.
  if (!(await isMOBI(file))) throw new UnsupportedTypeError('mobi (old PalmDOC format)')
  if (await isMobiDrm(file)) throw new DrmError()
  const { unzlibSync } = await import('../../../vendor/foliate-js/vendor/fflate.js')
  const book: any = await new MOBI({ unzlib: unzlibSync }).open(file)
  const resolve: ImageResolver = async src => {
    if (src.startsWith('recindex:')) return new Blob([await book.mobi.loadResource(Number(src.slice(9)) - 1)])
    if (src.startsWith('kindle:')) return (await book.loadResourceBlob(src))[0]
    return null
  }
  return fromBook(book, { resolverFor: () => resolve }, opts)
}

export async function parseFb2(file: Blob, zipped: boolean, opts: OpenOptions = {}): Promise<Parsed> {
  const { makeFB2 } = await import('../../../vendor/foliate-js/fb2.js')
  let blob = file
  if (zipped) {
    const loader = await zipLoader(file)
    const entry = loader.entries.find((e: any) => e.filename.endsWith('.fb2')) ?? loader.entries[0]
    blob = (await loader.loadBlob(entry.filename)) as Blob
  }
  // FB2 images are embedded <binary> elements that foliate turns into data: URLs.
  return fromBook(await makeFB2(blob), { resolverFor: () => noExternalImages }, opts)
}
