import type { RawSection } from './types'

// rt/rp: ruby annotations (furigana). Keeping them would duplicate text, e.g. "山路やまみち".
const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head', 'svg', 'iframe', 'object', 'title', 'rt', 'rp'])
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
  const texts: string[] = []
  let title: string | undefined
  let run = ''
  const flush = () => {
    const t = clean(run)
    if (t) texts.push(t)
    run = ''
  }
  const walk = (node: Node) => {
    if (node.nodeType === 3 || node.nodeType === 4) {
      run += node.nodeValue ?? ''
      return
    }
    if (node.nodeType !== 1 && node.nodeType !== 9) return
    const name = node.nodeType === 1 ? (node as Element).localName.toLowerCase() : ''
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
  return { title, texts }
}

/** Split plain text into paragraphs on blank lines (or single lines if there are none). */
export function textToParagraphs(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n')
  const parts = /\n\s*\n/.test(normalized) ? normalized.split(/\n\s*\n/) : normalized.split('\n')
  return parts.map(clean).filter(Boolean)
}

export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}
