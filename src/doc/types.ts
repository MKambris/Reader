/** Bump whenever block extraction changes in a way that could alter block ids or content. */
export const PARSER_VERSION = 3

export interface TextBlock {
  id: string
  kind: 'text'
  text: string
}

export interface ImageBlock {
  id: string
  kind: 'image'
  blob: Blob
  alt: string
}

/** A PDF page whose text layer is broken or missing: shown as an image until OCR fills it in. */
export interface OcrBlock {
  id: string
  kind: 'ocr'
  /** 1-based PDF page number. */
  page: number
}

export type Block = TextBlock | ImageBlock | OcrBlock

export interface Section {
  title: string
  blocks: Block[]
}

export interface Doc {
  title: string
  author?: string
  sections: Section[]
}

export interface OpenOptions {
  /** Called with a 0..1 fraction as parsing advances; always ends with 1. */
  onProgress?: (fraction: number) => void
}

/** Internal: a reference to an image found while walking markup, resolved to bytes later. */
export type RawImage =
  | { kind: 'image'; src: string; alt: string; width?: number; height?: number }
  /** Inline <svg>: kept as an element so nested <image> hrefs can be inlined before serializing. */
  | { kind: 'svg'; el: Element; alt: string }

export type RawItem = { kind: 'text'; text: string } | RawImage | { kind: 'blob'; blob: Blob; alt: string }

/** Internal: a parsed section before ids are assigned. */
export interface RawSection {
  title?: string
  items: RawItem[]
}

/** Internal: a section after images are resolved to Blobs, before ids are assigned. */
export type ParsedItem =
  | { kind: 'text'; text: string }
  | { kind: 'image'; blob: Blob; alt: string }
  | { kind: 'ocr'; page: number }
export interface ParsedSection {
  title?: string
  items: ParsedItem[]
}

/** Internal: output of a format parser, before ids are assigned. */
export interface Parsed {
  title?: string
  author?: string
  sections: ParsedSection[]
}

/** Resolves an image src (relative path, data: URL, recindex:N, kindle:embed:…) to bytes. */
export type ImageResolver = (src: string) => Promise<Blob | null>
