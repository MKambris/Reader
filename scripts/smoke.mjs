// Browser smoke test against `vite preview`. Usage: node scripts/smoke.mjs [url]
// Needs Chrome at /usr/bin/google-chrome (or CHROME env var).
import { chromium } from 'playwright-core'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
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

// AC9: offline launch and open.
await page.reload() // ensure SW controls the page
await page.waitForSelector('.books li')
await ctx.setOffline(true)
await page.reload()
await page.waitForSelector('.books li', { timeout: 10000 })
await page.locator('.book', { hasText: 'Fixture Book' }).first().click()
await page.waitForSelector('.block')
check('works offline', (await page.locator('.block').count()) > 0)
await ctx.setOffline(false)

check('no page errors', errors.length === 0, errors.join(' | '))
await ctx.close()
process.exit(results.every(r => r.ok) ? 0 : 1)
