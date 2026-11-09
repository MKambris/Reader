import type { Block, Doc } from '../doc/types'

const ARABIC_LETTER = /[ؠ-يٮ-ۓۺ-ۿ]/

/**
 * Tidy raw OCR output into paragraphs: drop direction marks, fix Tesseract's habit of
 * reading the Arabic comma "،" as "»" (only when no « is open), and join wrapped lines.
 */
export function cleanOcrText(raw: string): string[] {
  const noMarks = raw.replace(/[‎‏‪-‮⁦-⁩]/g, '')
  return noMarks
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map(p => fixCommas(p.replace(/\s*\n\s*/g, ' ').replace(/[ \t]+/g, ' ').trim()))
    .filter(Boolean)
}

function fixCommas(p: string): string {
  let open = 0
  let out = ''
  for (let i = 0; i < p.length; i++) {
    const c = p[i]
    if (c === '«') open++
    if (c === '»') {
      if (open > 0) open--
      else if (ARABIC_LETTER.test(p[i - 1] ?? '')) {
        out += '،'
        continue
      }
    }
    out += c
  }
  return out
}

/** Replace OCR placeholders with text blocks for every page that has OCR paragraphs. */
export function applyOcr(doc: Doc, pages: Map<number, string[]>): Doc {
  return {
    ...doc,
    sections: doc.sections.map(s => {
      const ph = s.blocks.find(b => b.kind === 'ocr')
      if (!ph || ph.kind !== 'ocr' || !pages.has(ph.page)) return s
      const si = ph.page - 1
      const blocks: Block[] = pages.get(ph.page)!.map((text, n) => ({ id: `s${si}b${n}`, kind: 'text', text }))
      return { ...s, blocks }
    }),
  }
}
