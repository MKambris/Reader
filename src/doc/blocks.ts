import type { RawImage, RawItem, RawSection } from './types'

// rt/rp: ruby annotations (furigana). Keeping them would duplicate text, e.g. "山路やまみち".
// <object> is NOT skipped: we never run embedded objects, so we show their fallback content.
const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head', 'svg', 'iframe', 'title', 'rt', 'rp', 'param'])
const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'caption', 'dd', 'div', 'dl', 'dt',
  'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li',
  'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
  'tr', 'ul', 'html',
])
const HEADING = /^h[1-6]$/

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * Flatten a DOM into plain-text paragraphs. Never touches innerHTML and never
 * attaches the node to a live document, so embedded scripts cannot execute.
 */
export function domToSection(root: Document | Element): RawSection {
  const items: RawItem[] = []
  let title: string | undefined
  let run = ''
  // Images met mid-paragraph are emitted after that paragraph's text, so they never
  // split a paragraph (which would renumber text blocks and break saved positions).
  let pending: RawImage[] = []
  const flush = () => {
    const t = clean(run)
    if (t) items.push({ kind: 'text', text: t })
    items.push(...pending)
    run = ''
    pending = []
  }
  const walk = (node: Node) => {
    if (node.nodeType === 3 || node.nodeType === 4) {
      run += node.nodeValue ?? ''
      return
    }
    if (node.nodeType !== 1 && node.nodeType !== 9) return
    const name = node.nodeType === 1 ? (node as Element).localName.toLowerCase() : ''
    if (name === 'img' || name === 'image') {
      const img = imageRef(node as Element)
      if (img) pending.push(img)
      return
    }
    if (name === 'svg') {
      const el = node as Element
      pending.push({ kind: 'svg', el, alt: clean(el.getElementsByTagName('title')[0]?.textContent ?? '') })
      return
    }
    if (SKIP.has(name)) return
    if (name === 'br') {
      run += ' '
      return
    }
    const isBlock = BLOCK.has(name) || name === 'mbp:pagebreak'
    if (isBlock) flush()
    for (const child of Array.from(node.childNodes)) walk(child)
    if (isBlock) {
      if (HEADING.test(name) && title === undefined) title = clean(run) || undefined
      flush()
    }
  }
  walk(root)
  flush()
  return { title, items }
}

const dim = (v: string | null) => {
  const n = v ? parseFloat(v) : NaN
  return Number.isFinite(n) ? n : undefined
}

/** <img src>, MOBI6 <img recindex>, or a standalone SVG-namespace <image href>. */
function imageRef(el: Element): RawImage | null {
  const src = el.getAttribute('src')
    ?? el.getAttribute('href')
    ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
    ?? (el.getAttribute('recindex') ? `recindex:${el.getAttribute('recindex')}` : null)
  if (!src) return null
  return {
    kind: 'image',
    src,
    alt: clean(el.getAttribute('alt') ?? el.getAttribute('title') ?? ''),
    width: dim(el.getAttribute('width')),
    height: dim(el.getAttribute('height')),
  }
}

export const textItems = (texts: string[]): { kind: 'text'; text: string }[] => texts.map(text => ({ kind: 'text', text }))

/** Split plain text into paragraphs on blank lines (or single lines if there are none). */
export function textToParagraphs(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n')
  const parts = /\n\s*\n/.test(normalized) ? normalized.split(/\n\s*\n/) : normalized.split('\n')
  return parts.map(clean).filter(Boolean)
}

export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}
