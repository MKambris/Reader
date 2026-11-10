/**
 * Identifies how cached OCR text was produced. Bump it whenever earlier results should be
 * thrown away and re-read. `+pdfjs-wasm`: before that fix, JBIG2 scans rendered black, so
 * any OCR saved from them is empty and must not be reused.
 */
export const OCR_ENGINE_VERSION = 'tesseract.js-7/ara-4.0.0_best_int+pdfjs-wasm'
