import { openDB, type IDBPDatabase } from 'idb'
import { isSupported, extensionOf, openDocument } from '../doc/openDocument'
import { UnsupportedTypeError } from '../doc/errors'
import { PARSER_VERSION, type Doc } from '../doc/types'
import type { OcrCache } from '../ocr/queue'
import { applyOcr, cleanOcrText } from '../ocr/text'

export interface BookMeta {
  id: string
  title: string
  author?: string
  fileName: string
  addedAt: number
}

export interface Position {
  blockId: string
  /** Index of the block divided by (block count − 1); survives re-parsing. */
  fraction: number
}

const STORES = ['books', 'files', 'docs', 'positions'] as const
const ocrRange = (bookId: string) => IDBKeyRange.bound(`${bookId}/`, `${bookId}/\uffff`)

/** Return the block to open at: saved blockId if it still exists, else the block nearest `fraction`. */
export function resolvePosition(doc: Doc, pos: Position | undefined): string | undefined {
  const ids = doc.sections.flatMap(s => s.blocks.map(b => b.id))
  if (!ids.length) return undefined
  if (pos && ids.includes(pos.blockId)) return pos.blockId
  // Same page/section, different block (e.g. an OCR placeholder that became text).
  const section = pos && /^s\d+(?=[a-z])/.exec(pos.blockId)?.[0]
  const sameSection = section && ids.find(id => new RegExp(`^${section}[a-z]`).test(id))
  if (sameSection) return sameSection
  const f = Math.min(1, Math.max(0, pos?.fraction ?? 0))
  return ids[Math.round(f * (ids.length - 1))]
}

export class Library {
  private constructor(private db: IDBPDatabase, readonly name: string) {}

  static async open(name = 'reader'): Promise<Library> {
    const db = await openDB(name, 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) for (const s of STORES) db.createObjectStore(s, { keyPath: 'id' })
        // v2 (spec 01c): OCR text per PDF page, keyed `${bookId}/${page}`.
        if (oldVersion < 2) db.createObjectStore('ocr', { keyPath: 'id' })
      },
    })
    return new Library(db, name)
  }

  /** Parse first; only a file that opens successfully is stored. */
  async importFile(file: File, onProgress?: (fraction: number) => void): Promise<BookMeta> {
    if (!isSupported(file.name)) throw new UnsupportedTypeError(extensionOf(file.name))
    const doc = await openDocument(file, { onProgress })
    const meta: BookMeta = {
      id: crypto.randomUUID(),
      title: doc.title,
      ...(doc.author ? { author: doc.author } : {}),
      fileName: file.name,
      addedAt: Date.now(),
    }
    const tx = this.db.transaction(['books', 'files', 'docs'], 'readwrite')
    await Promise.all([
      tx.objectStore('books').put(meta),
      tx.objectStore('files').put({ id: meta.id, blob: file }),
      tx.objectStore('docs').put({ id: meta.id, parserVersion: PARSER_VERSION, doc }),
      tx.done,
    ])
    return meta
  }

  async listBooks(): Promise<BookMeta[]> {
    const all = (await this.db.getAll('books')) as BookMeta[]
    return all.sort((a, b) => b.addedAt - a.addedAt)
  }

  /** Cached Doc, re-parsed from the stored file when the parser version has changed. */
  /** The parsed Doc with any cached OCR text already filled in. */
  async loadDoc(id: string): Promise<Doc> {
    return applyOcr(await this.loadParsedDoc(id), await this.ocrPages(id))
  }

  private async ocrPages(id: string): Promise<Map<number, string[]>> {
    const recs = await this.db.getAll('ocr', ocrRange(id))
    return new Map(recs.map(r => [r.page as number, cleanOcrText(r.text)]))
  }

  /** Per-book OCR cache for the OcrQueue. */
  ocrCache(bookId: string, engine: string): OcrCache {
    return {
      get: async page => (await this.db.get('ocr', `${bookId}/${page}`))?.text,
      put: async (page, text) => void (await this.db.put('ocr', { id: `${bookId}/${page}`, page, text, engine })),
    }
  }

  private async loadParsedDoc(id: string): Promise<Doc> {
    const cached = await this.db.get('docs', id)
    if (cached && cached.parserVersion === PARSER_VERSION) return cached.doc
    const [meta, file] = await Promise.all([this.db.get('books', id), this.db.get('files', id)])
    if (!meta || !file) throw new Error('Book not found')
    const doc = await openDocument(new File([file.blob], meta.fileName))
    await this.putCachedDoc(id, doc, PARSER_VERSION)
    return doc
  }

  /** The original imported file (e.g. for PDF page view). */
  async getFile(id: string): Promise<File | undefined> {
    const [meta, rec] = await Promise.all([this.db.get('books', id), this.db.get('files', id)])
    return meta && rec ? new File([rec.blob], meta.fileName) : undefined
  }

  async putCachedDoc(id: string, doc: Doc, parserVersion: number) {
    await this.db.put('docs', { id, parserVersion, doc })
  }

  async cachedParserVersion(id: string): Promise<number | undefined> {
    return (await this.db.get('docs', id))?.parserVersion
  }

  async savePosition(id: string, pos: Position) {
    await this.db.put('positions', { id, ...pos })
  }

  async getPosition(id: string): Promise<Position | undefined> {
    const p = await this.db.get('positions', id)
    return p ? { blockId: p.blockId, fraction: p.fraction } : undefined
  }

  async deleteBook(id: string) {
    const tx = this.db.transaction([...STORES, 'ocr'], 'readwrite')
    await Promise.all([...STORES.map(s => tx.objectStore(s).delete(id)), tx.objectStore('ocr').delete(ocrRange(id)), tx.done])
  }

  /** Test/diagnostic helper: how many records exist for this id in each store. */
  async rawCounts(id: string) {
    const out: Record<string, number> = {}
    for (const s of STORES) out[s] = await this.db.count(s, id)
    out.ocr = await this.db.count('ocr', ocrRange(id))
    return out
  }
}

/** Ask the browser not to evict our storage. Returns whether storage is persistent. */
export async function ensurePersisted(): Promise<boolean> {
  const sm = navigator.storage
  if (!sm?.persist) return false
  if (await sm.persisted()) return true
  return sm.persist()
}
