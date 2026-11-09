import { Readability } from '@mozilla/readability'
import { domToSection, parseHtml, textToParagraphs } from '../blocks'
import type { Parsed } from '../types'

export async function parseTxt(file: Blob): Promise<Parsed> {
  const text = new TextDecoder('utf-8').decode(await file.arrayBuffer())
  return { sections: [{ texts: textToParagraphs(text) }] }
}

/** Saved web page: strip site chrome with Readability, fall back to the whole body. */
export function parseHtmlString(html: string): Parsed {
  const doc = parseHtml(html)
  const pageTitle = doc.title?.trim() || undefined
  const article = new Readability(doc.cloneNode(true) as Document).parse()
  if (article?.content) {
    const section = domToSection(parseHtml(article.content).body)
    const title = article.title?.trim() || pageTitle
    // Readability keeps the <h1>; drop it when it just repeats the title.
    if (title && section.texts[0] === title) section.texts.shift()
    return { title, author: article.byline?.replace(/^by\s+/i, '').trim() || undefined, sections: [section] }
  }
  return { title: pageTitle, sections: [domToSection(doc.body)] }
}

export async function parseHtmlFile(file: Blob): Promise<Parsed> {
  return parseHtmlString(new TextDecoder('utf-8').decode(await file.arrayBuffer()))
}

export async function parseDocx(file: Blob): Promise<Parsed> {
  const mammoth = await import('mammoth')
  const ab = await file.arrayBuffer()
  // mammoth's Node build wants a Buffer; its browser build (picked by Vite) wants an ArrayBuffer.
  const input = typeof Buffer !== 'undefined' ? { buffer: Buffer.from(ab) } : { arrayBuffer: ab }
  const { value } = await (mammoth.default ?? mammoth).convertToHtml(input as any)
  const section = domToSection(parseHtml(value).body)
  return { title: section.title, sections: [section] }
}
