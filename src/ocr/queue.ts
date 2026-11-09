/** Reads one page and returns its raw text. Swappable (Tesseract today, PaddleOCR later). */
export interface OcrEngine {
  version: string
  recognize(page: number): Promise<string>
}

export interface OcrCache {
  get(page: number): Promise<string | undefined>
  put(page: number, text: string): Promise<void>
}

/** How many pages ahead of the reading position are OCR'd before the rest of the book. */
export const LOOKAHEAD = 5

/**
 * Background OCR scheduler (spec 01c): one page at a time, reading position first,
 * then the rest of the book from page 1. Cached pages are reported without re-OCR.
 */
export class OcrQueue {
  private remaining: Set<number>
  private position = 1
  private running = false
  private paused = false
  private stopped = false
  private wake: (() => void) | null = null
  private onFinished: (() => void) | null = null

  constructor(
    pages: number[],
    private engine: OcrEngine,
    private cache: OcrCache,
    private onDone: (page: number, text: string) => void,
    private onError: (page: number, e: unknown) => void = () => {},
  ) {
    this.remaining = new Set(pages)
  }

  setPosition(page: number) {
    this.position = page
  }

  /** Start the loop; `onFinished` fires when every page is done. */
  start(onFinished?: () => void) {
    this.onFinished = onFinished ?? null
    if (this.running) return
    this.running = true
    void this.loop()
  }

  pause() {
    this.paused = true
  }

  resume() {
    this.paused = false
    this.wake?.()
  }

  stop() {
    this.stopped = true
    this.wake?.()
  }

  get pending(): number {
    return this.remaining.size
  }

  private next(): number | undefined {
    for (let p = this.position; p <= this.position + LOOKAHEAD; p++) if (this.remaining.has(p)) return p
    let min: number | undefined
    for (const p of this.remaining) if (min === undefined || p < min) min = p
    return min
  }

  private async loop() {
    while (!this.stopped) {
      if (this.paused) {
        await new Promise<void>(r => (this.wake = r))
        this.wake = null
        continue
      }
      const page = this.next()
      if (page === undefined) break
      this.remaining.delete(page)
      try {
        let text = await this.cache.get(page)
        if (text === undefined) {
          text = await this.engine.recognize(page)
          await this.cache.put(page, text)
        }
        if (!this.stopped) this.onDone(page, text)
      } catch (e) {
        this.onError(page, e)
      }
      // Let the UI breathe between pages.
      await new Promise(r => setTimeout(r, 0))
    }
    this.running = false
    if (!this.stopped) this.onFinished?.()
  }
}
