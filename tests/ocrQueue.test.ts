import { describe, expect, it } from 'vitest'
import { OcrQueue, type OcrCache, type OcrEngine } from '../src/ocr/queue'
import { applyOcr, cleanOcrText } from '../src/ocr/text'
import type { Doc } from '../src/doc/types'

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

function fakes(cached: Record<number, string> = {}) {
  const calls: number[] = []
  const store = new Map(Object.entries(cached).map(([k, v]) => [Number(k), v]))
  const engine: OcrEngine = { version: 'fake-1', recognize: async p => (calls.push(p), `text ${p}`) }
  const cache: OcrCache = { get: async p => store.get(p), put: async (p, t) => void store.set(p, t) }
  return { calls, store, engine, cache }
}

const runAll = (q: OcrQueue) => new Promise<void>(r => q.start(r))

describe('AC4 OcrQueue order and caching', () => {
  it('starts at the reading position, 5 pages ahead, then continues from page 1', async () => {
    const f = fakes()
    const done: number[] = []
    const q = new OcrQueue(range(1, 20), f.engine, f.cache, p => done.push(p))
    q.setPosition(10)
    await runAll(q)
    expect(f.calls.slice(0, 6)).toEqual([10, 11, 12, 13, 14, 15])
    expect(f.calls.slice(6, 9)).toEqual([1, 2, 3])
    expect([...f.calls].sort((a, b) => a - b)).toEqual(range(1, 20))
    expect(done).toHaveLength(20)
  })

  it('never re-OCRs a cached page, but still reports it', async () => {
    const f = fakes({ 11: 'cached eleven' })
    const done = new Map<number, string>()
    const q = new OcrQueue(range(1, 12), f.engine, f.cache, (p, t) => done.set(p, t))
    q.setPosition(10)
    await runAll(q)
    expect(f.calls).not.toContain(11)
    expect(done.get(11)).toBe('cached eleven')
    expect(f.store.get(12)).toBe('text 12')
  })

  it('follows a moved reading position', async () => {
    const f = fakes()
    let q!: OcrQueue
    q = new OcrQueue(range(1, 30), f.engine, f.cache, p => p === 2 && q.setPosition(25))
    q.setPosition(1)
    await runAll(q)
    expect(f.calls.slice(0, 3)).toEqual([1, 2, 25])
  })

  it('pause stops new work until resume', async () => {
    const f = fakes()
    let q!: OcrQueue
    q = new OcrQueue(range(1, 5), f.engine, f.cache, p => p === 2 && q.pause())
    q.setPosition(1)
    const finished = runAll(q)
    await new Promise(r => setTimeout(r, 20))
    expect(f.calls).toEqual([1, 2])
    q.resume()
    await finished
    expect(f.calls).toEqual([1, 2, 3, 4, 5])
  })
})

describe('OCR text cleanup', () => {
  it('fixes the Arabic comma, drops direction marks, joins wrapped lines', () => {
    expect(cleanOcrText('قرأنا الكتاب» ثم كتبنا\nملخصا\u200E قصيرا\n\nفقرة ثانية')).toEqual([
      'قرأنا الكتاب، ثم كتبنا ملخصا قصيرا',
      'فقرة ثانية',
    ])
  })
  it('keeps a real opening/closing quote pair that is not after an Arabic word', () => {
    expect(cleanOcrText('قال: «نعم» ثم')).toEqual(['قال: «نعم» ثم'])
  })
})

describe('applyOcr', () => {
  it('replaces a page placeholder with numbered text blocks', () => {
    const doc: Doc = {
      title: 't',
      sections: [
        { title: 'Page 1', blocks: [{ id: 's0p0', kind: 'ocr', page: 1 }] },
        { title: 'Page 2', blocks: [{ id: 's1b0', kind: 'text', text: 'kept' }] },
      ],
    }
    const out = applyOcr(doc, new Map([[1, ['أ', 'ب']]]))
    expect(out.sections[0].blocks).toEqual([
      { id: 's0b0', kind: 'text', text: 'أ' },
      { id: 's0b1', kind: 'text', text: 'ب' },
    ])
    expect(out.sections[1]).toBe(doc.sections[1])
  })
})
