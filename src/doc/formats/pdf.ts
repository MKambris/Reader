import { NoTextError } from '../errors'
import { textItems } from '../blocks'
import { makeYielder } from '../images'
import type { OpenOptions, Parsed, ParsedSection } from '../types'

type TextItem = { str: string; transform: number[]; height: number; hasEOL?: boolean }

let workerReady: Promise<void> | null = null
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
  const lines: { y: number; h: number; text: string }[] = []
  let cur: { y: number; h: number; text: string } | null = null
  for (const it of items) {
    const y = it.transform[5]
    const h = it.height || Math.abs(it.transform[3]) || 10
    if (!cur || Math.abs(cur.y - y) > h * 0.5) {
      if (cur) lines.push(cur)
      cur = { y, h, text: '' }
    }
    cur.text += it.str
    if (it.hasEOL) {
      lines.push(cur)
      cur = null
    }
  }
  if (cur) lines.push(cur)

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
  const task = lib.getDocument({ data, useSystemFonts: true })
  const pdf = await task.promise
  try {
    const meta = (await pdf.getMetadata().catch(() => null))?.info as Record<string, unknown> | undefined
    const sections: ParsedSection[] = []
    const yieldNow = makeYielder()
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      const texts = pageParagraphs((content.items as unknown[]).filter((x): x is TextItem => typeof x === "object" && x !== null && "str" in x))
      sections.push({ title: `Page ${i}`, items: textItems(texts) })
      opts.onProgress?.(i / pdf.numPages)
      await yieldNow()
    }
    if (!sections.some(s => s.items.length)) throw new NoTextError()
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
    return { title: str(meta?.Title), author: str(meta?.Author), sections }
  } finally {
    await task.destroy()
  }
}
