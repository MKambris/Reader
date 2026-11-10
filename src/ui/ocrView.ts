import type { Library } from '../library/store'
import { OcrQueue } from '../ocr/queue'
import { cleanOcrText } from '../ocr/text'
import { createTesseractEngine, ENGINE_VERSION, OCR_DOWNLOAD_MB, openPdfPages, type PdfPages } from '../ocr/tesseract'

const CONSENT_KEY = 'reader.ocrConsent'
const consent = () => {
  try { return localStorage.getItem(CONSENT_KEY) } catch { return null }
}
const setConsent = (v: string) => {
  try { localStorage.setItem(CONSENT_KEY, v) } catch { /* private mode: ask again next time */ }
}

export interface OcrViewOptions {
  lib: Library
  bookId: string
  /** Text column; placeholders live inside it. */
  page: HTMLElement
  /** Live, ordered list of block elements (mutated in place when pages become text). */
  blocks: HTMLElement[]
  headerBottom: () => number
  topIndex: () => number
}

/** Build the placeholder shown for a page that still needs OCR. */
export function ocrPlaceholder(pageNo: number): HTMLElement {
  const box = document.createElement('figure')
  box.className = 'block ocr-page'
  box.dataset.ocrPage = String(pageNo)
  const label = document.createElement('figcaption')
  label.textContent = `Reading page ${pageNo}…`
  box.append(label)
  return box
}

/**
 * Drives spec 01c in the reader: draws placeholders as page images, asks once before
 * downloading OCR, runs the OcrQueue near the reading position, and swaps finished pages
 * to text without moving what the reader is looking at.
 */
export async function startOcrView(o: OcrViewOptions): Promise<{ positionChanged(): void; destroy(): void }> {
  const placeholders = () => o.blocks.filter(b => b.dataset.ocrPage)
  const noop = { positionChanged() {}, destroy() {} }
  if (!placeholders().length) return noop

  const file = await o.lib.getFile(o.bookId)
  if (!file) return noop
  let pages: PdfPages | null = await openPdfPages(file)
  let destroyed = false

  // Give every placeholder its final height now, so page images drawing in later never
  // shift the text below them (spec 01c AC5).
  for (const box of placeholders()) {
    const ratio = await pages.aspect(Number(box.dataset.ocrPage)).catch(() => 8.5 / 11)
    box.style.aspectRatio = String(ratio)
  }

  // Page images for placeholders near the viewport.
  const drawn = new Map<HTMLElement, HTMLCanvasElement>()
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      const box = e.target as HTMLElement
      if (e.isIntersecting && !drawn.has(box) && pages) {
        const width = Math.round(box.clientWidth * Math.min(devicePixelRatio || 1, 2))
        pages.render(Number(box.dataset.ocrPage), width).then(c => {
          if (destroyed || !box.isConnected) return void (c.width = 0)
          drawn.set(box, c)
          box.prepend(c)
        }).catch(() => {})
      } else if (!e.isIntersecting && drawn.has(box)) {
        const c = drawn.get(box)!
        c.width = c.height = 0
        c.remove()
        drawn.delete(box)
      }
    }
  }, { rootMargin: '50% 0px' })
  placeholders().forEach(p => io.observe(p))

  const label = (text: string) => placeholders().forEach(p => (p.querySelector('figcaption')!.textContent = text))

  /** Replace a page placeholder with paragraphs, keeping the visible content still. */
  const swap = (pageNo: number, raw: string) => {
    const box = o.blocks.find(b => b.dataset.ocrPage === String(pageNo))
    if (!box) return
    const paras = cleanOcrText(raw)
    const nodes = (paras.length ? paras : ['']).map((t, n) => {
      const p = document.createElement('p')
      p.className = 'block'
      p.dir = 'auto'
      p.textContent = t
      p.dataset.id = `s${pageNo - 1}b${n}`
      return p
    })
    const anchorIdx = o.topIndex()
    const anchor = o.blocks[anchorIdx]
    const anchorTop = anchor?.getBoundingClientRect().top ?? 0
    const replacingAnchor = anchor === box

    io.unobserve(box)
    drawn.get(box)?.remove()
    drawn.delete(box)
    box.replaceWith(...nodes)
    o.blocks.splice(o.blocks.indexOf(box), 1, ...nodes)

    const keep = replacingAnchor ? nodes[0] : anchor
    if (keep) window.scrollBy(0, keep.getBoundingClientRect().top - anchorTop)
  }

  let queue: OcrQueue | null = null
  let engine: Awaited<ReturnType<typeof createTesseractEngine>> | null = null
  const currentPage = () => {
    const id = o.blocks[o.topIndex()]?.dataset.id ?? 's0'
    return Number(/^s(\d+)/.exec(id)?.[1] ?? 0) + 1
  }
  const onVisibility = () => (document.hidden ? queue?.pause() : queue?.resume())

  const begin = async () => {
    label('Preparing text recognition…')
    try {
      engine = await createTesseractEngine(pages!)
    } catch (e) {
      label('Text recognition could not start. Showing page images.')
      console.error(e)
      return
    }
    if (destroyed) return void engine.terminate()
    label('Waiting to read this page…')
    const todo = placeholders().map(p => Number(p.dataset.ocrPage))
    queue = new OcrQueue(todo, engine, o.lib.ocrCache(o.bookId, ENGINE_VERSION), swap, (p, e) =>
      console.warn(`OCR failed on page ${p}`, e))
    queue.setPosition(currentPage())
    document.addEventListener('visibilitychange', onVisibility)
    queue.start()
  }

  if (consent() === 'yes') void begin()
  else {
    const banner = document.createElement('div')
    banner.className = 'ocr-banner'
    banner.dir = 'auto'
    const msg = document.createElement('p')
    msg.textContent = `This PDF's text can't be read directly. Download text recognition (about ${OCR_DOWNLOAD_MB} MB, once) to read it?`
    const yes = document.createElement('button')
    yes.className = 'primary'
    yes.textContent = 'Download'
    const no = document.createElement('button')
    no.textContent = 'Not now'
    yes.onclick = () => {
      setConsent('yes')
      banner.remove()
      void begin()
    }
    no.onclick = () => {
      banner.remove()
      label('Text recognition is off. Showing the page image.')
    }
    banner.append(msg, yes, no)
    o.page.prepend(banner)
    label('Page image (text recognition not downloaded)')
  }

  return {
    positionChanged() {
      queue?.setPosition(currentPage())
    },
    destroy() {
      destroyed = true
      queue?.stop()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      drawn.forEach(c => (c.width = c.height = 0))
      // Order matters: let OCR finish its page before closing the PDF it renders from.
      const p = pages
      pages = null
      void (async () => {
        await engine?.terminate().catch(() => {})
        await p?.destroy().catch(() => {})
      })()
    },
  }
}
