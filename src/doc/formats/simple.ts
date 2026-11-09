import { Readability } from '@mozilla/readability'
import { domToSection, parseHtml, textItems, textToParagraphs } from '../blocks'
import { noExternalImages, resolveSection } from '../images'
import type { ImageResolver, Parsed } from '../types'

export async function parseTxt(file: Blob): Promise<Parsed> {
  const text = new TextDecoder('utf-8').decode(await file.arrayBuffer())
  return { sections: [{ items: textItems(textToParagraphs(text)) }] }
}

/** Saved web page: strip site chrome with Readability, fall back to the whole body. */
export async function parseHtmlString(html: string, resolve: ImageResolver = noExternalImages): Promise<Parsed> {
  const doc = parseHtml(html)
  const pageTitle = doc.title?.trim() || undefined
  const article = new Readability(doc.cloneNode(true) as Document).parse()
  if (article?.content) {
    const section = domToSection(parseHtml(article.content).body)
    const title = article.title?.trim() || pageTitle
    // Readability keeps the <h1>; drop it when it just repeats the title.
    const first = section.items[0]
    if (title && first?.kind === 'text' && first.text === title) section.items.shift()
    return {
      title,
      author: article.byline?.replace(/^by\s+/i, '').trim() || undefined,
      sections: [await resolveSection(section, resolve)],
    }
  }
  return { title: pageTitle, sections: [await resolveSection(domToSection(doc.body), resolve)] }
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
  // mammoth embeds images as data: URLs.
  const section = await resolveSection(domToSection(parseHtml(value).body), noExternalImages)
  return { title: section.title, sections: [section] }
}
