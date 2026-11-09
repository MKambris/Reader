import './style.css'
import { Library, ensurePersisted, resolvePosition, type BookMeta } from './library/store'
import type { Doc } from './doc/types'

const app = document.getElementById('app')!
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text // text only — never innerHTML
  return e
}

let lib: Library
let persistWarning = false
/** Incremented on every navigation so a slower, older render never paints over a newer one. */
let renderToken = 0

async function showLibrary(message?: string) {
  const token = ++renderToken
  const books = await lib.listBooks()
  if (token !== renderToken) return
  app.replaceChildren()
  const header = el('header', 'bar')
  header.append(el('h1', '', 'Library'))
  const importBtn = el('button', 'primary', 'Import')
  // No `accept` filter: Android greys out .azw3/.fb2 when filtered, so we validate after picking.
  const input = el('input')
  input.type = 'file'
  input.multiple = true
  input.hidden = true
  importBtn.onclick = () => input.click()
  input.onchange = () => importFiles(Array.from(input.files ?? []))
  header.append(importBtn, input)
  app.append(header)

  if (persistWarning) {
    app.append(el('p', 'warn', 'Android may clear your library if the phone runs low on storage.'))
  }
  if (message) app.append(el('p', 'msg', message))

  if (!books.length) {
    app.append(el('p', 'empty', 'No books yet. Tap Import and pick a file from anywhere on your phone.'))
    return
  }
  const list = el('ul', 'books')
  for (const b of books) list.append(bookRow(b))
  app.append(list)
}

function bookRow(b: BookMeta) {
  const li = el('li')
  const open = el('button', 'book')
  open.append(el('span', 'title', b.title))
  if (b.author) open.append(el('span', 'author', b.author))
  open.onclick = () => showReader(b)
  const del = el('button', 'delete', 'Delete')
  del.setAttribute('aria-label', `Delete ${b.title}`)
  del.onclick = async () => {
    await lib.deleteBook(b.id)
    showLibrary()
  }
  li.append(open, del)
  return li
}

async function importFiles(files: File[]) {
  if (!files.length) return
  showLibrary('Importing…')
  const errors: string[] = []
  for (const f of files) {
    try {
      await lib.importFile(f)
    } catch (e) {
      errors.push(`${f.name}: ${(e as Error).message}`)
    }
  }
  if (!persistWarning) persistWarning = !(await ensurePersisted())
  showLibrary(errors.join('\n') || undefined)
}

async function showReader(meta: BookMeta) {
  const token = ++renderToken
  app.replaceChildren()
  const header = el('header', 'bar')
  const back = el('button', '', '← Library')
  header.append(back, el('h1', 'reader-title', meta.title))
  const page = el('main', 'page')
  app.append(header, page)

  let doc: Doc
  try {
    doc = await lib.loadDoc(meta.id)
    if (token !== renderToken) return
  } catch (e) {
    page.append(el('p', 'msg', (e as Error).message))
    back.onclick = () => showLibrary()
    return
  }

  const blocks: HTMLElement[] = []
  for (const s of doc.sections) {
    page.append(el('h2', 'section', s.title))
    for (const b of s.blocks) {
      const p = el('p', 'block', b.text)
      p.dataset.id = b.id
      page.append(p)
      blocks.push(p)
    }
  }

  const saved = await lib.getPosition(meta.id)
  if (token !== renderToken) return
  const target = resolvePosition(doc, saved)
  const headerBottom = () => header.getBoundingClientRect().bottom
  const targetEl = blocks.find(b => b.dataset.id === target)
  window.scrollTo(0, 0)
  if (targetEl) window.scrollTo(0, targetEl.getBoundingClientRect().top - headerBottom())

  /** First block whose bottom is below the header (binary search; blocks are in document order). */
  const topBlockIndex = () => {
    const top = headerBottom() + 1
    let lo = 0, hi = blocks.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (blocks[mid].getBoundingClientRect().bottom <= top) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  const save = () => {
    if (!blocks.length) return
    const i = topBlockIndex()
    lib.savePosition(meta.id, {
      blockId: blocks[i].dataset.id!,
      fraction: blocks.length > 1 ? i / (blocks.length - 1) : 0,
    })
  }
  let timer: number | undefined
  const onScroll = () => {
    clearTimeout(timer)
    timer = window.setTimeout(save, 300)
  }
  const onHide = () => document.visibilityState === 'hidden' && save()
  window.addEventListener('scroll', onScroll, { passive: true })
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', save)
  back.onclick = () => {
    save()
    window.removeEventListener('scroll', onScroll)
    document.removeEventListener('visibilitychange', onHide)
    window.removeEventListener('pagehide', save)
    window.scrollTo(0, 0)
    showLibrary()
  }
}

// We restore reading position ourselves; the browser's own restore would fight it.
history.scrollRestoration = 'manual'

Library.open().then(async l => {
  lib = l
  if (navigator.storage?.persisted && (await lib.listBooks()).length) {
    persistWarning = !(await navigator.storage.persisted())
  }
  showLibrary()
})
