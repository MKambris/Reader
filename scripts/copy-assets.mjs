// Copy runtime assets into public/ so they're served from the app's own origin:
// - public/ocr/: Tesseract.js worker, core WASM builds and the Arabic model (spec 01c)
// - public/pdfjs/: PDF.js decoders (JBIG2/JPEG 2000/ICC wasm), CMaps, standard fonts.
//   Without these, scanned PDFs (usually JBIG2) render as black pages.
import { copyFileSync, cpSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = join(import.meta.dirname, '..')
const out = join(root, 'public', 'ocr')
mkdirSync(out, { recursive: true })

const tjs = dirname(require.resolve('tesseract.js/package.json'))
const core = dirname(require.resolve('tesseract.js-core/package.json'))
const ara = dirname(require.resolve('@tesseract.js-data/ara/package.json'))

copyFileSync(join(tjs, 'dist', 'worker.min.js'), join(out, 'worker.min.js'))
// LSTM-only core builds (all we use); Tesseract.js picks SIMD/relaxed-SIMD/plain at runtime.
for (const f of readdirSync(core)) if (/^tesseract-core.*-?lstm\.wasm\.js$/.test(f)) copyFileSync(join(core, f), join(out, f))
copyFileSync(join(ara, '4.0.0_best_int', 'ara.traineddata.gz'), join(out, 'ara.traineddata.gz'))
console.log('OCR assets ->', out, readdirSync(out).join(', '))

const pdfjs = dirname(require.resolve('pdfjs-dist/package.json'))
const pdfOut = join(root, 'public', 'pdfjs')
for (const dir of ['wasm', 'cmaps', 'standard_fonts', 'iccs']) {
  cpSync(join(pdfjs, dir), join(pdfOut, dir), { recursive: true })
}
console.log('PDF.js assets ->', pdfOut, readdirSync(pdfOut).join(', '))
