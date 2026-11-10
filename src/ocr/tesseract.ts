import { createWorker, OEM, type Worker } from 'tesseract.js'
import { pdfjs, pdfParams } from '../doc/formats/pdf'
import type { OcrEngine } from './queue'

/** Rough first-use download: core WASM (~3.9 MB) + Arabic model (~1.7 MB). */
export const OCR_DOWNLOAD_MB = 5.6
export { OCR_ENGINE_VERSION as ENGINE_VERSION } from './version'
import { OCR_ENGINE_VERSION } from './version'

/** Target bitmap width for OCR (~200 dpi for a letter/A4 page). */
const OCR_WIDTH = 1700

export interface PdfPages {
  numPages: number
  /** Width ÷ height of a page. */
  aspect(page: number): Promise<number>
  /** Draw a page into a new canvas `width` device pixels wide. */
  render(page: number, width: number): Promise<HTMLCanvasElement>
  destroy(): Promise<void>
}

export async function openPdfPages(file: Blob): Promise<PdfPages> {
  const lib = await pdfjs()
  const task = lib.getDocument(await pdfParams(new Uint8Array(await file.arrayBuffer())))
  const pdf = await task.promise
  // Renders still running when the reader closes; destroy() waits for them, because tearing
  // down PDF.js mid-render throws "Cannot read properties of null (reading 'postMessage')".
  const inflight = new Set<Promise<unknown>>()
  let closed = false
  const track = <T>(p: Promise<T>): Promise<T> => {
    inflight.add(p)
    return p.finally(() => inflight.delete(p))
  }
  return {
    numPages: pdf.numPages,
    async aspect(pageNo) {
      if (closed) throw new Error('PDF closed')
      const v = (await track(pdf.getPage(pageNo))).getViewport({ scale: 1 })
      return v.width / v.height
    },
    render: (pageNo, width) => {
      if (closed) return Promise.reject(new Error('PDF closed'))
      return track(renderPage(pageNo, width))
    },
    async destroy() {
      closed = true
      await Promise.allSettled([...inflight])
      await task.destroy()
    },
  }

  async function renderPage(pageNo: number, width: number): Promise<HTMLCanvasElement> {
      const page = await pdf.getPage(pageNo)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: width / base.width })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport } as any).promise
      return canvas
  }
}

/**
 * Tesseract.js (Arabic LSTM model) served from our own origin: spec 01c chose `ara` only,
 * because `ara+eng` turned vowel-marked Arabic into Latin junk on the user's PDFs.
 * Tesseract runs in its own Web Worker; we only render the page bitmap here.
 */
export async function createTesseractEngine(pages: PdfPages): Promise<OcrEngine & { terminate(): Promise<void> }> {
  const base = new URL(`${import.meta.env.BASE_URL}ocr/`, location.href).href
  const worker: Worker = await createWorker('ara', OEM.LSTM_ONLY, {
    workerPath: base + 'worker.min.js',
    corePath: base,
    langPath: base,
    gzip: true,
    workerBlobURL: false,
    cacheMethod: 'none', // the service worker caches /ocr/ files; avoid a second IndexedDB copy
  })
  let job: Promise<unknown> | null = null
  let dead = false
  return {
    version: OCR_ENGINE_VERSION,
    async recognize(page) {
      if (dead) throw new Error('OCR stopped')
      const run = (async () => {
        const canvas = await pages.render(page, OCR_WIDTH)
        try {
          if (dead) throw new Error('OCR stopped')
          const { data } = await worker.recognize(canvas)
          return data.text
        } finally {
          canvas.width = canvas.height = 0
        }
      })()
      job = run
      try {
        return await run
      } finally {
        if (job === run) job = null
      }
    },
    /** Waits for the page being read, then stops the worker (same mid-job crash as above). */
    async terminate() {
      dead = true
      await job?.catch(() => {})
      await worker.terminate()
    },
  }
}
