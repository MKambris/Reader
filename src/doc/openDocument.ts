import { UnsupportedTypeError } from './errors'
import { parseEpub, parseFb2, parseMobi } from './formats/foliate'
import { parseMhtml } from './formats/mhtml'
import { parsePdf } from './formats/pdf'
import { parseDocx, parseHtmlFile, parseTxt } from './formats/simple'
import type { Block, Doc, OpenOptions, Parsed } from './types'

type Parser = (f: File, opts: OpenOptions) => Promise<Parsed>

const BY_EXT: Record<string, Parser> = {
  epub: parseEpub,
  mobi: parseMobi, azw: parseMobi, azw3: parseMobi, prc: parseMobi,
  fb2: (f, o) => parseFb2(f, false, o), fbz: (f, o) => parseFb2(f, true, o), 'fb2.zip': (f, o) => parseFb2(f, true, o),
  pdf: parsePdf,
  docx: parseDocx,
  txt: parseTxt,
  html: parseHtmlFile, htm: parseHtmlFile, xhtml: parseHtmlFile,
  mhtml: parseMhtml, mht: parseMhtml,
}

export const SUPPORTED_EXTENSIONS = Object.keys(BY_EXT)

export function extensionOf(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.fb2.zip')) return 'fb2.zip'
  const i = lower.lastIndexOf('.')
  return i >= 0 ? lower.slice(i + 1) : ''
}

export const isSupported = (name: string) => extensionOf(name) in BY_EXT

const baseName = (name: string) => name.replace(/\.(fb2\.zip|[^.]+)$/i, '').trim() || name

/**
 * Parse any supported file into the shared Doc model.
 * Text block ids are `s{section}b{n}`; image block ids are `s{section}i{n}`, counted separately
 * so adding images never renumbers text (saved positions stay valid).
 */
export async function openDocument(file: File, opts: OpenOptions = {}): Promise<Doc> {
  const ext = extensionOf(file.name)
  const parse = BY_EXT[ext]
  if (!parse) throw new UnsupportedTypeError(ext)
  const parsed = await parse(file, opts)
  const sections = parsed.sections
    .map((s, si) => {
      let bi = 0, ii = 0
      const blocks: Block[] = s.items.map(it =>
        it.kind === 'text'
          ? { id: `s${si}b${bi++}`, kind: 'text', text: it.text }
          : { id: `s${si}i${ii++}`, kind: 'image', blob: it.blob, alt: it.alt })
      return { title: s.title || `Section ${si + 1}`, blocks }
    })
    .filter(s => s.blocks.length)
  opts.onProgress?.(1)
  return {
    title: parsed.title || parsed.sections.find(s => s.items.some(i => i.kind === 'text'))?.title || baseName(file.name),
    ...(parsed.author ? { author: parsed.author } : {}),
    sections,
  }
}
