// Browser smoke test against `vite preview`. Usage: node scripts/smoke.mjs [url]
// Needs Chrome at /usr/bin/google-chrome (or CHROME env var).
import { chromium } from 'playwright-core'
import { join } from 'node:path'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const URL = process.argv[2] ?? 'http://localhost:4173/'
const FIX = join(import.meta.dirname, '..', 'tests', 'fixtures')
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}

// Persistent (non-incognito) profile: Chrome refuses installability checks in incognito.
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'reader-smoke-')), {
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  viewport: { width: 400, height: 800 },
})
const page = ctx.pages()[0] ?? await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => m.type() === 'error' && errors.push(m.text()))

await page.goto(URL)
await page.waitForSelector('text=Library')

// AC6: no accept filter; supported files import; unsupported rejected.
check('picker has no accept filter', (await page.locator('input[type=file]').getAttribute('accept')) === null)
const all = ['book.epub', 'book.mobi', 'book.azw3', 'book.fb2', 'book.pdf', 'book.docx', 'book.txt', 'article.html', 'article.mhtml']
await page.setInputFiles('input[type=file]', [...all.map(f => join(FIX, f))])
await page.waitForFunction(n => document.querySelectorAll('.books li').length === n, all.length, { timeout: 60000 })
check('9 formats imported in browser', true)
await page.setInputFiles('input[type=file]', [join(FIX, 'drm.epub')])
await page.waitForSelector('.msg:has-text("DRM-protected")')
check('DRM message shown', true)
await page.locator('input[type=file]').setInputFiles({ name: 'notes.xyz', mimeType: 'text/plain', buffer: Buffer.from('x') })
await page.waitForSelector('.msg:has-text("Unsupported file type: .xyz")')
check('unsupported message shown, not added', (await page.locator('.books li').count()) === all.length)

// AC11: persistence requested.
const persisted = await page.evaluate(() => navigator.storage.persisted())
const warn = await page.locator('.warn').count()
check('persist granted or warning shown', persisted || warn === 1, `persisted=${persisted} warning=${warn}`)

// AC7: position survives a reload.
await page.locator('.book', { hasText: 'Fixture Book' }).first().click()
await page.waitForSelector('.block')
const targetId = await page.evaluate(() => {
  const b = document.querySelectorAll('.block')
  const t = b[Math.min(4, b.length - 1)]
  const hb = document.querySelector('.bar').getBoundingClientRect().bottom
  window.scrollBy(0, t.getBoundingClientRect().top - hb - 10) // like a user: block just below the header
  return t.dataset.id
})
await page.waitForTimeout(600)
await page.reload()
await page.waitForSelector('.books li')
await page.locator('.book', { hasText: 'Fixture Book' }).first().click()
await page.waitForSelector('.block')
await page.waitForTimeout(200)
const topId = await page.evaluate(() => {
  const top = document.querySelector('.bar').getBoundingClientRect().bottom
  return [...document.querySelectorAll('.block')].find(b => b.getBoundingClientRect().bottom > top)?.dataset.id
})
check('reopens at saved block', topId === targetId, `saved=${targetId} reopened=${topId}`)

// AC13 in a real browser: script EPUB does not execute.
await page.locator('button:has-text("Library")').click()
await page.setInputFiles('input[type=file]', [join(FIX, 'script.epub')])
await page.waitForFunction(n => document.querySelectorAll('.books li').length === n, all.length + 1)
await page.locator('.book').first().click()
await page.waitForSelector('.block')
check('embedded script did not run', await page.evaluate(() => window.__pwned === undefined))
await page.locator('button:has-text("Library")').click()

// AC8: delete survives reload.
await page.waitForSelector('.books li')
const before = await page.locator('.books li').count()
await page.locator('.delete').first().click()
await page.waitForFunction(n => document.querySelectorAll('.books li').length === n - 1, before)
await page.reload()
await page.waitForSelector('.books li')
check('delete persists after reload', (await page.locator('.books li').count()) === before - 1)

// AC10: installable (manifest + SW), via Chrome's own installability check.
await page.evaluate(() => navigator.serviceWorker.ready)
const cdp = await ctx.newCDPSession(page)
const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors')
check('Chrome reports installable', installabilityErrors.length === 0, JSON.stringify(installabilityErrors))

// ---------- Spec 01b: images, PDF page view, import progress ----------
const backToLibrary = async () => {
  if (await page.locator('button:has-text("Library")').count()) await page.locator('button:has-text("Library")').click()
  await page.waitForSelector('text=Import')
}
/** Empty the library, import exactly these fixtures, open the first one. */
const importOnly = async (...files) => {
  await backToLibrary()
  while (await page.locator('.delete').count()) {
    const n = await page.locator('.delete').count()
    await page.locator('.delete').first().click()
    await page.waitForFunction(k => document.querySelectorAll('.delete').length < k, n)
  }
  await page.setInputFiles('input[type=file]', files.map(f => (f.startsWith('/') ? f : join(FIX, f))))
  await page.waitForFunction(k => document.querySelectorAll('.books li').length === k, files.length, { timeout: 120000 })
  await page.locator('.book').first().click()
  await page.waitForSelector('.block')
}
const imagesLoaded = () => page.evaluate(async () => {
  const imgs = [...document.querySelectorAll('.block.image img')]
  imgs.forEach(i => (i.loading = 'eager'))
  await Promise.all(imgs.map(i => i.decode().catch(() => null)))
  return imgs.map(i => ({ w: i.naturalWidth, shown: i.getBoundingClientRect().width, col: i.closest('.page').clientWidth }))
})

// AC5: illustration sits between the right paragraphs and fits the column.
await importOnly('book.epub')
const order = await page.evaluate(() => [...document.querySelectorAll('.block')].map(b => b.classList.contains('image') ? 'IMG' : b.textContent.slice(0, 20)))
const iImg = order.indexOf('IMG')
const iBefore = order.findIndex(t => t.startsWith('It was a bright cold'))
const iAfter = order.findIndex(t => t.startsWith('The hallway smelt'))
const loaded = await imagesLoaded()
check('01b AC5 image between paragraphs', iBefore < iImg && iImg < iAfter, order.join(' | '))
check('01b AC5 image decodes and fits column', loaded.length === 1 && loaded[0].w > 0 && loaded[0].shown <= loaded[0].col, JSON.stringify(loaded))

// AC6: SVG pictures render, scripts inside them don't run.
await importOnly('svg-script.epub')
const svgs = await imagesLoaded()
check('01b AC6 SVGs render, scripts inert', svgs.filter(x => x.w > 0).length >= 3 && await page.evaluate(() => window.__pwned === undefined), JSON.stringify(svgs))

// Right-to-left text (Arabic) aligns right.
await importOnly('arabic.txt')
const rtl = await page.evaluate(() => [...document.querySelectorAll('.block')].map(b => getComputedStyle(b).direction))
check('Arabic paragraphs are right-to-left', rtl.length > 0 && rtl.every(d => d === 'rtl'), rtl.join(','))

// AC7/AC8: PDF page view.
await importOnly('long.pdf')
check('01b AC7 Page view button on PDF', (await page.locator('.view-toggle').count()) === 1)
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.block')].find(x => x.dataset.id.startsWith('s6b'))
  window.scrollBy(0, b.getBoundingClientRect().top - document.querySelector('.bar').getBoundingClientRect().bottom - 5)
})
await page.locator('.view-toggle').click()
await page.waitForSelector('.pdf-page canvas')
const topPage = () => page.evaluate(() => {
  const top = document.querySelector('.bar').getBoundingClientRect().bottom + 1
  return Number([...document.querySelectorAll('.pdf-page')].find(b => b.getBoundingClientRect().bottom > top)?.dataset.page)
})
check('01b AC7 page view opens at current page', (await topPage()) === 7, `page=${await topPage()}`)
let maxCanvases = 0
for (let y = 0; y < 30; y++) {
  await page.mouse.wheel(0, 400)
  await page.waitForTimeout(120)
  maxCanvases = Math.max(maxCanvases, await page.locator('.pdf-page canvas').count())
}
check('01b AC8 at most 5 canvases', maxCanvases > 0 && maxCanvases <= 5, `max=${maxCanvases}`)
await page.evaluate(() => {
  const box = document.querySelector('.pdf-page[data-page="12"]')
  window.scrollBy(0, box.getBoundingClientRect().top - document.querySelector('.bar').getBoundingClientRect().bottom)
})
await page.waitForTimeout(200)
await page.locator('.view-toggle').click()
await page.waitForSelector('.page:not([hidden]) .block')
const topText = await page.evaluate(() => {
  const top = document.querySelector('.bar').getBoundingClientRect().bottom + 1
  return [...document.querySelectorAll('.block')].find(b => b.getBoundingClientRect().bottom > top)?.dataset.id
})
check('01b AC7 text view returns to page 12', topText?.startsWith('s11'), `top=${topText}`)

// AC12: big import stays responsive and shows rising progress.
const MAHA = '/home/claude/samples/epub3/mahabharata.epub'
if (existsSync(MAHA)) {
  await backToLibrary()
  await page.evaluate(() => {
    window.__long = []
    new PerformanceObserver(l => l.getEntries().forEach(e => window.__long.push(e.duration))).observe({ type: 'longtask', buffered: false })
  })
  await page.setInputFiles('input[type=file]', [MAHA])
  const progress = []
  const t0 = Date.now()
  while (Date.now() - t0 < 120000) {
    const msg = await page.locator('.msg').first().textContent().catch(() => '')
    const m = /(\d+)%/.exec(msg ?? '')
    if (m) progress.push(Number(m[1]))
    if (await page.locator('.book', { hasText: 'महाभारत' }).count()) break
    await page.waitForTimeout(1000)
  }
  const longest = Math.max(0, ...(await page.evaluate(() => window.__long)))
  const rising = progress.length > 2 && progress.every((p, i) => i === 0 || p >= progress[i - 1]) && progress.at(-1) > progress[0]
  check('01b AC12 progress shown and rising', rising, progress.join(','))
  check('01b AC12 no frame over 200ms', longest <= 200, `longest task ${Math.round(longest)}ms`)
} else console.log('SKIP 01b AC12 (mahabharata sample not present)')

// ---------- Spec 01c: Arabic PDFs & OCR ----------
const AR_WORDS = ['القراءة', 'المكتبة', 'القهوة']
const pageText = (pageNo) => page.evaluate(n => [...document.querySelectorAll(`.block[data-id^="s${n - 1}b"]`)].map(b => b.textContent).join(' '), pageNo)
const waitForOcrText = async (pageNo, timeout) => {
  const t0 = Date.now()
  await page.waitForFunction(n => document.querySelector(`.block[data-id^="s${n - 1}b"]`), pageNo, { timeout })
  return Date.now() - t0
}
const quality = (t) => {
  const words = t.split(/\s+/).filter(w => /\p{L}/u.test(w))
  // Arabic letters plus vowel marks (Script=Inherited), digits and punctuation.
  const arabic = words.filter(w => /^[\p{Script=Arabic}\p{M}\p{N}\p{P}\p{S}]+$/u.test(w) && /\p{Script=Arabic}/u.test(w)).length
  return { words: words.length, arabicShare: arabic / Math.max(1, words.length), latin: /[A-Za-z]/.test(t), replacement: t.includes('\uFFFD') }
}

// AC1 in the browser: a good Arabic PDF reads as text, right-to-left.
await importOnly('arabic-good.pdf')
check('01c AC1 good Arabic PDF has no OCR pages', (await page.locator('.ocr-page').count()) === 0)

// AC2 + consent: a scanned PDF opens; nothing downloads until the user agrees.
await importOnly('arabic-scanned.pdf')
check('01c AC2 scanned PDF opens with a page image', (await page.locator('.ocr-page').count()) === 1)
await page.waitForSelector('.ocr-page canvas', { timeout: 15000 })
const ocrFetchedEarly = await page.evaluate(() => performance.getEntriesByType('resource').some(e => e.name.includes('/ocr/')))
check('01c OCR not downloaded before consent', !ocrFetchedEarly)
await page.locator('.ocr-banner button.primary').click()
const firstMs = await waitForOcrText(1, 120000)
const q1 = quality(await pageText(1))
check('01c OCR reads the scanned Arabic page', q1.arabicShare >= 0.95 && !q1.latin && !q1.replacement,
  `${firstMs}ms ${JSON.stringify(q1)}`)
const scannedText = await pageText(1)
check('01c OCR text contains the fixture sentences', AR_WORDS.every(w => scannedText.includes(w)), scannedText.slice(0, 80))
check('01c OCR text is right-to-left', await page.evaluate(() => getComputedStyle(document.querySelector('.block[data-id^="s0b"]')).direction === 'rtl'))

// AC5: page swaps to text without moving what's on screen. Read page 2 while page 1 is still pending.
await importOnly('arabic-broken.pdf')
await page.evaluate(() => {
  const box = document.querySelector('.ocr-page[data-ocr-page="2"]')
  window.scrollBy(0, box.getBoundingClientRect().top - document.querySelector('.bar').getBoundingClientRect().bottom)
})
await page.waitForTimeout(400) // let the scroll handler report the reading position
const topBefore = await page.evaluate(() => document.querySelector('.ocr-page[data-ocr-page="2"]').getBoundingClientRect().top)
await waitForOcrText(2, 120000)
const topAfter = await page.evaluate(() => document.querySelector('.block[data-id="s1b0"]').getBoundingClientRect().top)
check('01c AC5 swap keeps the reading spot still', Math.abs(topAfter - topBefore) <= 2, `before=${topBefore} after=${topAfter}`)
await waitForOcrText(1, 120000)
const topLater = await page.evaluate(() => document.querySelector('.block[data-id="s1b0"]').getBoundingClientRect().top)
check('01c AC5 swap of the page above does not move it either', Math.abs(topLater - topBefore) <= 2, `after page 1 swapped: ${topLater}`)

// AC7: one page in under 15 s with the CPU throttled x4 (model already cached).
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
await importOnly('arabic-scanned.pdf')
const throttledMs = await waitForOcrText(1, 60000)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
check('01c AC7 OCR page under 15 s at 4x CPU throttle', throttledMs < 15000, `${throttledMs}ms`)

// AC6 (local only): the user's own PDFs, never committed.
const USER_A = '/home/claude/samples/user/a.pdf', USER_B = '/home/claude/samples/user/b.pdf'
if (existsSync(USER_A) && existsSync(USER_B)) {
  for (const [file, pageNo] of [[USER_A, 8], [USER_B, 20]]) {
    await importOnly(file)
    await page.evaluate(n => {
      const box = document.querySelector(`.ocr-page[data-ocr-page="${n}"]`)
      window.scrollBy(0, box.getBoundingClientRect().top - document.querySelector('.bar').getBoundingClientRect().bottom)
    }, pageNo)
    await page.waitForTimeout(400)
    const ms = await waitForOcrText(pageNo, 180000)
    const t = await pageText(pageNo)
    const q = quality(t)
    const ok = q.arabicShare >= 0.95 && !q.latin && !q.replacement
    check(`01c AC6 user PDF ${file.endsWith('a.pdf') ? 'A' : 'B'} page ${pageNo}`, ok, `${ms}ms words=${q.words} arabic=${(q.arabicShare * 100).toFixed(1)}% latin=${q.latin} repl=${q.replacement}`)
    // Expected title lives next to the (uncommitted) user PDFs, hand-checked against the page image.
    const titleFile = '/home/claude/samples/user/a8-title.txt'
    if (file === USER_A && existsSync(titleFile)) {
      const title = readFileSync(titleFile, 'utf8').trim()
      check('01c AC6 user PDF A page 8 title line exact', t.startsWith(title), `got ${t.length} chars`)
    }
  }
} else console.log('SKIP 01c AC6 (user PDFs not present)')

// Leave a book with an image + the PDF in the library for the offline checks.
await importOnly('book.epub', 'long.pdf')
await backToLibrary()

// AC9: offline launch and open.
await page.reload() // ensure SW controls the page
await page.waitForSelector('.books li')
await ctx.setOffline(true)
await page.reload()
await page.waitForSelector('.books li', { timeout: 10000 })
await page.locator('.book', { hasText: 'Fixture Book' }).first().click()
await page.waitForSelector('.block')
check('works offline', (await page.locator('.block').count()) > 0)
check('01b AC10 images work offline', (await imagesLoaded()).some(x => x.w > 0))
await backToLibrary()
await page.locator('.book', { hasText: 'Long Fixture' }).first().click()
await page.waitForSelector('.block')
await page.locator('.view-toggle').click()
await page.waitForSelector('.pdf-page canvas', { timeout: 15000 }).catch(() => null)
check('01b AC10 page view works offline', (await page.locator('.pdf-page canvas').count()) > 0)
// 01c AC8: OCR works offline once the model is cached, on a newly imported broken PDF.
await importOnly('arabic-broken.pdf')
const offlineMs = await waitForOcrText(1, 120000).catch(() => -1)
check('01c AC8 OCR works offline', offlineMs >= 0, `${offlineMs}ms`)
await ctx.setOffline(false)

check('no page errors', errors.length === 0, errors.join(' | '))
await ctx.close()
process.exit(results.every(r => r.ok) ? 0 : 1)
