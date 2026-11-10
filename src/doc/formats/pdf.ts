import { textItems } from '../blocks'
import { classifyPage, normalizeArabic, orderLine, type LineItem } from '../pdfText'
import { makeYielder } from '../images'
import type { OpenOptions, Parsed, ParsedSection } from '../types'

type TextItem = { str: string; transform: number[]; height: number; hasEOL?: boolean; dir?: string }

let workerReady: Promise<void> | null = null
/**
 * Where PDF.js finds its decoders and data. Without `wasmUrl`, JBIG2 (most black-and-white
 * scans), JPEG 2000 and ICC colour images fail to decode and pages render black.
 * Browser: served from our own origin (scripts/copy-assets.mjs). Node (tests): the package dir.
 */
let assetBase: Promise<string> | null = null
async function pdfAssetBase(): Promise<string> {
  assetBase ??= (async () => {
    if (typeof process !== 'undefined' && process.versions?.node) {
      const { createRequire } = await import('node:module')
      const { dirname } = await import('node:path')
      return dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')) + '/'
    }
    return new URL(`${import.meta.env.BASE_URL}pdfjs/`, location.href).href
  })()
  return assetBase
}

/** The one way to open a PDF in this app; always includes the decoder/data locations. */
export async function pdfParams(data: Uint8Array) {
  const base = await pdfAssetBase()
  return {
    data,
    useSystemFonts: true,
    wasmUrl: base + 'wasm/',
    cMapUrl: base + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: base + 'standard_fonts/',
    iccUrl: base + 'iccs/',
  }
}

export async function pdfjs() {
  const lib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  workerReady ??= (async () => {
    if (lib.GlobalWorkerOptions.workerSrc) return
    if (typeof process !== 'undefined' && process.versions?.node) {
      const { createRequire } = await import('node:module')
      const req = createRequire(import.meta.url)
      lib.GlobalWorkerOptions.workerSrc = req.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
    } else {
      const url = await import('pdfjs-dist/legacy/build/pdf.worker.mjs?url')
      lib.GlobalWorkerOptions.workerSrc = url.default
    }
  })()
  await workerReady
  return lib
}

/** Group a page's text items into paragraphs using line breaks and vertical gaps. */
function pageParagraphs(items: TextItem[]): string[] {
  type Line = { y: number; h: number; items: LineItem[]; text: string }
  const lines: Line[] = []
  let cur: Line | null = null
  const close = () => {
    if (!cur) return
    // Right-to-left lines come out in visual order; put them into reading order.
    cur.text = normalizeArabic(orderLine(cur.items))
    lines.push(cur)
    cur = null
  }
  for (const it of items) {
    const y = it.transform[5]
    const h = it.height || Math.abs(it.transform[3]) || 10
    if (!cur || Math.abs(cur.y - y) > h * 0.5) {
      close()
      cur = { y, h, items: [], text: '' }
    }
    cur.items.push({ str: it.str, x: it.transform[4], dir: it.dir })
    if (it.hasEOL) close()
  }
  close()

  const paras: string[] = []
  let buf: string[] = []
  let prev: { y: number; h: number } | null = null
  for (const line of lines) {
    const t = line.text.replace(/\s+/g, ' ').trim()
    if (!t) continue
    // A gap larger than ~1.8 line heights starts a new paragraph.
    if (prev && prev.y - line.y > Math.max(prev.h, line.h) * 1.8) {
      paras.push(buf.join(' '))
      buf = []
    }
    // Rejoin hyphenated line breaks.
    if (buf.length && /[a-z]-$/.test(buf[buf.length - 1])) {
      buf[buf.length - 1] = buf[buf.length - 1].slice(0, -1) + t
    } else buf.push(t)
    prev = line
  }
  if (buf.length) paras.push(buf.join(' '))
  return paras
}

export async function parsePdf(file: Blob, opts: OpenOptions = {}): Promise<Parsed> {
  const lib = await pdfjs()
  const data = new Uint8Array(await file.arrayBuffer())
  const task = lib.getDocument(await pdfParams(data))
  const pdf = await task.promise
  try {
    const meta = (await pdf.getMetadata().catch(() => null))?.info as Record<string, unknown> | undefined
    const sections: ParsedSection[] = []
    const yieldNow = makeYielder()
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      const items = (content.items as unknown[]).filter((x): x is TextItem => typeof x === 'object' && x !== null && 'str' in x)
      // Judge the reassembled text: raw items can be single glyphs that look like 1-letter junk.
      const paras = pageParagraphs(items)
      const quality = classifyPage(paras.join('\n'))
      // Broken or missing text layers are read later by OCR (spec 01c); show the page meanwhile.
      sections.push({
        title: `Page ${i}`,
        items: quality === 'ok' ? textItems(paras) : [{ kind: 'ocr', page: i }],
      })
      opts.onProgress?.(i / pdf.numPages)
      await yieldNow()
    }
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
    return { title: str(meta?.Title), author: str(meta?.Author), sections }
  } finally {
    await task.destroy()
  }
}
