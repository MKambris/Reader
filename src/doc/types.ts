/** Bump whenever block extraction changes in a way that could alter block ids. */
export const PARSER_VERSION = 1

export interface Block {
  id: string
  text: string
}

export interface Section {
  title: string
  blocks: Block[]
}

export interface Doc {
  title: string
  author?: string
  sections: Section[]
}

/** Internal: output of a format parser, before ids are assigned. */
export interface Parsed {
  title?: string
  author?: string
  sections: RawSection[]
}

/** Internal: a parsed section before ids are assigned. */
export interface RawSection {
  title?: string
  texts: string[]
}
