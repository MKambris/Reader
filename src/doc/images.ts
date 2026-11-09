import type { ImageResolver, ParsedItem, ParsedSection, RawItem, RawSection } from './types'

/** Blobs smaller than this, or images declared ≤ 16 px on a side, are spacers/tracking pixels. */
export const MIN_IMAGE_BYTES = 512
const MIN_SIDE = 16

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'

/** Image type from magic bytes; containers often omit or mislabel it. */
export async function sniffImageType(blob: Blob): Promise<string | null> {
  // 1 KB: SVG files may carry a long XML prolog, DOCTYPE or comments before <svg>.
  const b = new Uint8Array(await blob.slice(0, 1024).arrayBuffer())
  const ascii = String.fromCharCode(...b)
  if (b[0] === 0x89 && ascii.slice(1, 4) === 'PNG') return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (ascii.startsWith('GIF8')) return 'image/gif'
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp'
  if (ascii.startsWith('BM')) return 'image/bmp'
  if (/<svg[\s>]/i.test(ascii)) return 'image/svg+xml'
  return null
}

/** Re-wrap a blob with its sniffed image type, or null if it isn't an image. */
export async function asImage(blob: Blob | null): Promise<Blob | null> {
  if (!blob) return null
  const type = await sniffImageType(blob)
  if (!type) return null
  // Copy bytes rather than wrapping: blobs can come from another realm (e.g. zip.js under Node),
  // and a foreign Blob passed as a BlobPart may be stringified instead of copied.
  return blob.type === type && blob instanceof Blob ? blob : new Blob([await blob.arrayBuffer()], { type })
}

export function dataUrlToBlob(src: string): Blob | null {
  const m = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,(.*)$/s.exec(src)
  if (!m) return null
  const [, type, , b64, data] = m
  try {
    const bytes = b64
      ? Uint8Array.from(atob(data.replace(/\s+/g, '')), c => c.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(data))
    return new Blob([bytes], { type: type || 'application/octet-stream' })
  } catch {
    return null
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${blob.type};base64,${btoa(bin)}`
}

/**
 * Serialize an inline <svg> to a standalone image. Nested <image> hrefs are inlined as
 * data: URLs because an SVG shown through <img> can't load external resources.
 */
async function svgToBlob(el: Element, resolve: ImageResolver): Promise<Blob> {
  const copy = el.cloneNode(true) as Element
  if (!copy.getAttribute('xmlns')) copy.setAttribute('xmlns', SVG_NS)
  for (const img of Array.from(copy.getElementsByTagNameNS(SVG_NS, 'image'))) {
    const href = img.getAttribute('href') ?? img.getAttributeNS(XLINK_NS, 'href')
    if (!href || href.startsWith('data:')) continue
    const blob = await asImage(await resolve(href).catch(() => null))
    if (!blob) continue
    img.removeAttributeNS(XLINK_NS, 'href')
    img.setAttribute('href', await blobToDataUrl(blob))
  }
  const xml = new XMLSerializer().serializeToString(copy)
  return new Blob([xml], { type: 'image/svg+xml' })
}

/** Turn raw image references into image Blobs; drop unresolvable and spacer images. */
export async function resolveItems(items: RawItem[], resolve: ImageResolver): Promise<ParsedItem[]> {
  const out: ParsedItem[] = []
  for (const item of items) {
    if (item.kind === 'text') {
      out.push(item)
      continue
    }
    let blob: Blob | null = null
    if (item.kind === 'blob') blob = await asImage(item.blob)
    else if (item.kind === 'svg') blob = await svgToBlob(item.el, resolve)
    else {
      if ((item.width !== undefined && item.width <= MIN_SIDE) || (item.height !== undefined && item.height <= MIN_SIDE)) continue
      const raw = item.src.startsWith('data:') ? dataUrlToBlob(item.src) : await resolve(item.src).catch(() => null)
      blob = await asImage(raw)
    }
    // The byte floor targets raster spacers; vector SVG pictures are legitimately tiny.
    if (!blob || (blob.type !== 'image/svg+xml' && blob.size < MIN_IMAGE_BYTES)) continue
    out.push({ kind: 'image', blob, alt: item.alt })
  }
  return out
}

export async function resolveSection(s: RawSection, resolve: ImageResolver): Promise<ParsedSection> {
  return { title: s.title, items: await resolveItems(s.items, resolve) }
}

/** Resolver for formats where every image is already a data: URL (FB2, DOCX, plain HTML). */
export const noExternalImages: ImageResolver = async () => null

/** Yield to the event loop when we've held the main thread for more than `budgetMs`. */
export function makeYielder(budgetMs = 30) {
  let last = performance.now()
  return async () => {
    if (performance.now() - last < budgetMs) return
    await new Promise(r => setTimeout(r, 0))
    last = performance.now()
  }
}
