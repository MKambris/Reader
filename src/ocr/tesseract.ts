import { createWorker, OEM, type Worker } from 'tesseract.js'
import { pdfjs } from '../doc/formats/pdf'
import type { OcrEngine } from './queue'

/** Rough first-use download: core WASM (~3.9 MB) + Arabic model (~1.7 MB). */
export const OCR_DOWNLOAD_MB = 5.6
export const ENGINE_VERSION = 'tesseract.js-7/ara-4.0.0_best_int'

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
  const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: true })
  const pdf = await task.promise
  return {
    numPages: pdf.numPages,
    async aspect(pageNo) {
      const v = (await pdf.getPage(pageNo)).getViewport({ scale: 1 })
      return v.width / v.height
    },
    async render(pageNo, width) {
      const page = await pdf.getPage(pageNo)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: width / base.width })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport } as any).promise
      return canvas
    },
    destroy: () => task.destroy(),
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
  return {
    version: ENGINE_VERSION,
    async recognize(page) {
      const canvas = await pages.render(page, OCR_WIDTH)
      try {
        const { data } = await worker.recognize(canvas)
        return data.text
      } finally {
        canvas.width = canvas.height = 0
      }
    },
    terminate: async () => void (await worker.terminate()),
  }
}
