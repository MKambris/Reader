/** Text-layer quality checks and right-to-left reconstruction for PDF pages. */

export type PageQuality = 'ok' | 'broken' | 'empty'

const isLetter = (c: string) => /\p{L}/u.test(c)
const ARABIC = /\p{Script=Arabic}/u
const LATIN = /[A-Za-zÀ-ɏ]/

/**
 * Decide whether a page's extracted text can be trusted.
 * Thresholds come from spec 01c and were checked against the user's PDFs.
 */
export function classifyPage(text: string): PageQuality {
  const chars = [...text]
  const letters = chars.filter(isLetter)
  if (letters.length < 20) return 'empty'

  const visible = chars.filter(c => !/\s/.test(c))
  const bad = chars.filter(c => c === '�' || /[-]/.test(c)).length
  if (bad / letters.length > 0.05) return 'broken'
  // Glyph ids leaking through as control characters (font without a ToUnicode map).
  const control = chars.filter(c => /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(c)).length
  if (control / Math.max(1, visible.length) > 0.02) return 'broken'

  const accented = letters.filter(c => /[À-ɏ]/.test(c)).length
  if (accented / letters.length > 0.1) return 'broken'

  const words = text.split(/\s+/).filter(w => [...w].some(isLetter))
  const single = words.filter(w => [...w].filter(isLetter).length === 1 && [...w].length <= 2).length
  if (words.length >= 10 && single / words.length >= 0.4) return 'broken'
  const mixed = words.filter(w => ARABIC.test(w) && LATIN.test(w)).length
  if (mixed / Math.max(1, words.length) > 0.05) return 'broken'
  return 'ok'
}

/** NFKC only on Arabic presentation forms, so other compatibility characters (ﬁ, ①) survive. */
export function normalizeArabic(s: string): string {
  return s.replace(/[ﭐ-﷿ﹰ-﻿]+/g, m => m.normalize('NFKC'))
}

export interface LineItem {
  str: string
  x: number
  dir?: string
}

const STRONG_LTR = /[A-Za-z0-9À-ɏ]/
const STRONG_RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/

/**
 * Turn one line of PDF text items into reading order.
 * Mostly right-to-left lines are stored in visual (left→right) order: reverse the items,
 * but keep runs of left-to-right words (English, numbers) in their own order.
 * Each item's own string is already in logical order (PDF.js handles that per item).
 */
export function orderLine(items: LineItem[]): string {
  const rtl = items.reduce((n, i) => n + [...i.str].filter(c => STRONG_RTL.test(c)).length, 0)
  const ltr = items.reduce((n, i) => n + [...i.str].filter(c => STRONG_LTR.test(c)).length, 0)
  if (rtl <= ltr) return items.map(i => i.str).join('')

  const visual = [...items].sort((a, b) => a.x - b.x)
  const kind = (i: LineItem) => (STRONG_RTL.test(i.str) ? 'R' : STRONG_LTR.test(i.str) ? 'L' : 'N')
  // Group into runs; neutrals between two L items belong to the L run.
  const runs: { ltr: boolean; items: LineItem[] }[] = []
  visual.forEach((it, idx) => {
    let k = kind(it)
    if (k === 'N') {
      const prevL = runs.at(-1)?.ltr
      const nextL = visual.slice(idx + 1).find(n => kind(n) !== 'N')
      k = prevL && nextL && kind(nextL) === 'L' ? 'L' : 'R'
    }
    const last = runs.at(-1)
    if (last && last.ltr === (k === 'L')) last.items.push(it)
    else runs.push({ ltr: k === 'L', items: [it] })
  })
  return runs
    .reverse()
    .map(r => (r.ltr ? r.items : [...r.items].reverse()).map(i => i.str).join(''))
    .join('')
}
