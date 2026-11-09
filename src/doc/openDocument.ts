import { UnsupportedTypeError } from './errors'
import { parseEpub, parseFb2, parseMobi } from './formats/foliate'
import { parseMhtml } from './formats/mhtml'
import { parsePdf } from './formats/pdf'
import { parseDocx, parseHtmlFile, parseTxt } from './formats/simple'
import type { Doc, Parsed } from './types'

type Parser = (f: File) => Promise<Parsed>

const BY_EXT: Record<string, Parser> = {
  epub: parseEpub,
  mobi: parseMobi, azw: parseMobi, azw3: parseMobi, prc: parseMobi,
  fb2: f => parseFb2(f, false), fbz: f => parseFb2(f, true), 'fb2.zip': f => parseFb2(f, true),
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

/** Parse any supported file into the shared Doc model. Block ids are `s{section}b{block}`. */
export async function openDocument(file: File): Promise<Doc> {
  const ext = extensionOf(file.name)
  const parse = BY_EXT[ext]
  if (!parse) throw new UnsupportedTypeError(ext)
  const parsed = await parse(file)
  const sections = parsed.sections
    .map((s, si) => ({
      title: s.title || `Section ${si + 1}`,
      blocks: s.texts.map((text, bi) => ({ id: `s${si}b${bi}`, text })),
    }))
    .filter(s => s.blocks.length)
  return {
    title: parsed.title || parsed.sections.find(s => s.texts.length)?.title || baseName(file.name),
    ...(parsed.author ? { author: parsed.author } : {}),
    sections,
  }
}
