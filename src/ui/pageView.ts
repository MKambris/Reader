import { pdfjs, pdfParams } from '../doc/formats/pdf'

export interface PageView {
  /** 1-based page whose box is at the top of the viewport (below `topOffset`). */
  topPage(): number
  scrollToPage(page: number): void
  destroy(): Promise<void>
}

/**
 * Original-layout PDF view. Each page is a placeholder sized from page 1's aspect ratio;
 * a canvas is drawn only while the page is within half a screen of the viewport and is
 * removed again when it leaves, so long PDFs never hold more than a few canvases.
 */
export async function createPageView(
  file: Blob,
  container: HTMLElement,
  topOffset: () => number,
): Promise<PageView> {
  const lib = await pdfjs()
  const task = lib.getDocument(await pdfParams(new Uint8Array(await file.arrayBuffer())))
  const pdf = await task.promise
  const first = (await pdf.getPage(1)).getViewport({ scale: 1 })

  const boxes: HTMLElement[] = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const box = document.createElement('div')
    box.className = 'pdf-page'
    box.dataset.page = String(n)
    box.style.aspectRatio = `${first.width} / ${first.height}`
    container.append(box)
    boxes.push(box)
  }

  const rendering = new Map<HTMLElement, { cancel(): void }>()
  const draw = async (box: HTMLElement) => {
    if (box.querySelector('canvas') || rendering.has(box)) return
    const page = await pdf.getPage(Number(box.dataset.page))
    const base = page.getViewport({ scale: 1 })
    const cssWidth = box.clientWidth || container.clientWidth
    const scale = (cssWidth / base.width) * Math.min(window.devicePixelRatio || 1, 2)
    const viewport = page.getViewport({ scale })
    box.style.aspectRatio = `${base.width} / ${base.height}`
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const job = page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport } as any)
    rendering.set(box, job)
    try {
      await job.promise
      if (rendering.get(box) === job) box.replaceChildren(canvas)
    } catch {
      /* cancelled */
    } finally {
      if (rendering.get(box) === job) rendering.delete(box)
    }
  }
  const clear = (box: HTMLElement) => {
    rendering.get(box)?.cancel()
    rendering.delete(box)
    const canvas = box.querySelector('canvas')
    if (canvas) {
      canvas.width = canvas.height = 0 // release the backing store promptly
      box.replaceChildren()
    }
  }

  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      const box = e.target as HTMLElement
      if (e.isIntersecting) draw(box)
      else clear(box)
    }
  }, { rootMargin: '50% 0px' })
  boxes.forEach(b => io.observe(b))

  return {
    topPage() {
      const top = topOffset() + 1
      return Number(boxes.find(b => b.getBoundingClientRect().bottom > top)?.dataset.page ?? 1)
    },
    scrollToPage(page: number) {
      const box = boxes[Math.min(Math.max(page, 1), boxes.length) - 1]
      window.scrollTo(0, 0)
      if (box) window.scrollTo(0, box.getBoundingClientRect().top - topOffset())
    },
    async destroy() {
      io.disconnect()
      boxes.forEach(clear)
      await task.destroy()
    },
  }
}
