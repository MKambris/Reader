import { parseHtmlString } from './simple'
import type { Parsed } from '../types'

const latin1 = (b: Uint8Array) => Array.from(b, c => String.fromCharCode(c)).join('')
const bytesOf = (s: string) => Uint8Array.from(s, c => c.charCodeAt(0) & 0xff)

function decodeQP(body: string): Uint8Array {
  const s = body.replace(/=\r?\n/g, '')
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      out.push(parseInt(s.slice(i + 1, i + 3), 16))
      i += 2
    } else out.push(s.charCodeAt(i) & 0xff)
  }
  return Uint8Array.from(out)
}

function headers(block: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of block.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) map.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim())
  }
  return map
}

/** Extract the first text/html part of an MHTML (MIME multipart/related) archive. */
export function mhtmlToHtml(raw: Uint8Array): string {
  const text = latin1(raw)
  const split = text.search(/\r?\n\r?\n/)
  const top = headers(text.slice(0, split))
  const boundary = /boundary="?([^";]+)"?/i.exec(top.get('content-type') ?? '')?.[1]
  if (!boundary) throw new Error('MHTML: missing multipart boundary')
  for (const part of text.split('--' + boundary).slice(1)) {
    if (part.startsWith('--')) break
    const p = part.replace(/^\r?\n/, '')
    const sep = p.search(/\r?\n\r?\n/)
    if (sep < 0) continue
    const h = headers(p.slice(0, sep))
    const type = h.get('content-type') ?? ''
    if (!/^text\/html/i.test(type)) continue
    const body = p.slice(sep).replace(/^\r?\n\r?\n/, '').replace(/\r?\n$/, '')
    const enc = (h.get('content-transfer-encoding') ?? '').toLowerCase()
    const bytes = enc === 'quoted-printable' ? decodeQP(body)
      : enc === 'base64' ? bytesOf(atob(body.replace(/\s+/g, '')))
      : bytesOf(body)
    const charset = /charset="?([^";]+)"?/i.exec(type)?.[1] ?? 'utf-8'
    let decoder: TextDecoder
    try { decoder = new TextDecoder(charset) } catch { decoder = new TextDecoder('utf-8') }
    return decoder.decode(bytes)
  }
  throw new Error('MHTML: no text/html part')
}

export async function parseMhtml(file: Blob): Promise<Parsed> {
  return parseHtmlString(mhtmlToHtml(new Uint8Array(await file.arrayBuffer())))
}
