import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyPage, normalizeArabic, orderLine } from '../src/doc/pdfText'
import { openDocument } from '../src/doc/openDocument'
import type { Doc } from '../src/doc/types'

const FIX = join(__dirname, 'fixtures')
const load = (name: string) => new File([readFileSync(join(FIX, name))], name)
const texts = (d: Doc) => d.sections.flatMap(s => s.blocks).flatMap(b => (b.kind === 'text' ? [b.text] : []))
const pending = (d: Doc) => d.sections.flatMap(s => s.blocks).filter(b => b.kind === 'ocr')

// Same sentences as ARABIC_LINES in scripts/make_fixtures.py.
const LINES = [
  'القراءة بصوت عال تساعد على الفهم والتذكر.',
  'يجلس الطالب في المكتبة ويقرأ كتابا جديدا كل أسبوع.',
  'استخدمت برنامج Reader على هاتفي لقراءة الكتب.',
  'في الصباح نشرب القهوة ثم نبدأ العمل بنشاط.',
]

describe('classifyPage', () => {
  it('ok for clean Arabic and clean English', () => {
    expect(classifyPage(LINES.join(' '))).toBe('ok')
    expect(classifyPage('It was a bright cold day in April, and the clocks were striking thirteen.')).toBe('ok')
  })
  it('empty under 20 letters', () => {
    expect(classifyPage('')).toBe('empty')
    expect(classifyPage('١٢٣ ص ٥')).toBe('empty')
  })
  it('broken: single-letter junk (user book pattern)', () => {
    expect(classifyPage('Á £ Á Q ! o # m 0 Ì Õ § ¿ o , ± ( Ì Ã n K G 0 Õ § n 9 ¢ ¿ Q 7 أ ﻻ أ '.repeat(3))).toBe('broken')
  })
  it('broken: replacement / private-use characters', () => {
    expect(classifyPage('نقرأ الد�رس معا ثم نكتب الم�لخص في الد�فتر  بعناية')).toBe('broken')
  })
  it('broken: control characters from glyph ids', () => {
    expect(classifyPage('\u0011ᒨᓕᒦᒒᓙՕձ\u0003ᓜᓦᓎᓙՕ\u0003ᓪᓚᓖᒨᓕᒦᒒᓙՕձ\u0003ᓜᓦ')).toBe('broken')
  })
  it('broken: Arabic and Latin letters mixed inside words', () => {
    expect(classifyPage('lÒlÑFةاب oةاب kمر صàr£lUمر ماOمp âالfاO الÒlةÑF ∏bةoك')).toBe('broken')
  })
})

describe('orderLine (visual → reading order)', () => {
  const item = (str: string, x: number, dir = 'rtl') => ({ str, x, dir })
  it('reverses right-to-left items', () => {
    // Visual left→right: ". ر ك ذ ت ل وا" → logical "والتذكر."
    const vis = ['.', 'ر', 'ك', 'ذ', 'ت', 'ل', 'وا'].map((s, i) => item(s, i * 10, s === '.' ? 'ltr' : 'rtl'))
    expect(orderLine(vis)).toBe('والتذكر.')
  })
  it('keeps an English run in order inside an Arabic line', () => {
    const vis = [item('على', 0), item(' ', 10, 'ltr'), item('R', 20, 'ltr'), item('e', 25, 'ltr'), item('ader', 30, 'ltr'), item(' ', 50, 'ltr'), item('برنامج', 60)]
    expect(orderLine(vis)).toBe('برنامج Reader على')
  })
  it('leaves left-to-right lines in stream order', () => {
    expect(orderLine([item('Hello', 0, 'ltr'), item(' world', 30, 'ltr')])).toBe('Hello world')
  })
})

describe('normalizeArabic', () => {
  it('maps presentation forms to standard letters, leaves other text alone', () => {
    expect(normalizeArabic('ﻟﻻ ﺮ')).toBe('للا ر')
    expect(normalizeArabic('ﬁ ①')).toBe('ﬁ ①') // NFKC only on the Arabic presentation ranges
  })
})

describe('AC1/AC3 good Arabic PDF', () => {
  it('reads every page as text in reading order', async () => {
    const doc = await openDocument(load('arabic-good.pdf'))
    expect(pending(doc)).toHaveLength(0)
    expect(texts(doc)).toEqual([...LINES, ...LINES])
    expect(texts(doc).join('')).not.toMatch(/[ﭐ-﷿ﹰ-﻿]/)
  })
})

describe('AC2 broken and scanned PDFs become OCR pages', () => {
  it('arabic-broken.pdf: every page pending OCR, no junk text', async () => {
    const doc = await openDocument(load('arabic-broken.pdf'))
    expect(pending(doc).map(b => (b as any).page)).toEqual([1, 2])
    expect(texts(doc)).toEqual([])
  })
  it('scanned.pdf now opens with its page pending OCR', async () => {
    const doc = await openDocument(load('scanned.pdf'))
    expect(pending(doc)).toHaveLength(1)
    expect(pending(doc)[0].id).toBe('s0p0')
  })
})
