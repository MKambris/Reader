# Spec 01c — Arabic PDFs & OCR

**Amends:** Spec 01 (AC4: scanned PDFs are no longer rejected) and 01b.

## Problem
Some PDFs have a broken text layer: the page looks fine, but the stored letters are wrong (`lÒlÑF`, `�`) or missing (scans). The reader shows that garbage, and read-aloud would speak it. Correctly made Arabic PDFs need care too: their text often comes out with words in visual (left-to-right) order and in letter shapes meant for display rather than reading.

## Solution
Each PDF page is checked when it's imported. Pages with a good text layer use it, put into correct right-to-left reading order with standard Arabic letters. Pages whose text is broken or missing are read with on-device OCR, in the background, just ahead of where you're reading. Until a page has been read it shows as its page image. The OCR text is saved, so each page is only read once.

## Decisions
- `classifyPage(text) → 'ok' | 'broken' | 'empty'` is a pure function. Pages with under 20 letters are `empty`. A page is `broken` when any of these is true: more than 5% of its letters are U+FFFD (the "�" replacement character) or private-use code points; more than 5% of its words mix Arabic and Latin letters; **at least 40% of its words are a single letter**; or more than 10% of its letters are Latin-1/Latin Extended accented letters. The user's 295-page book had no `�` at all. Its broken pages are one-character junk like `Á £ Á Q ! o #`, which the single-letter rule catches.
- Good-text handling: within each line, a line that is mostly right-to-left has its items ordered by x from right to left. Arabic presentation-form letters (U+FB50–FDFF, U+FE70–FEFF) are converted to standard letters (NFKC on those ranges only).
- OCR engine: **Tesseract.js with the `ara` model only** (about 1.4 MB). Results from the comparison on 6 pages of the user's two PDFs: 0.8–1.7 s per page on desktop, 88–99% clean Arabic words, 0 Latin or junk words. Errors cluster on fully vowel-marked words (Qur'an quotes) and on the Arabic comma, which comes out as `»`. `ara+eng` was worse: it turned vowel-marked words into Latin junk. PaddleOCR PP-OCRv5 Arabic **could not be tested** because the workspace can't reach Hugging Face or GitHub raw files. It's deferred to a later in-browser comparison, and the `OcrEngine` interface keeps it swappable.
- The Tesseract worker, core WASM and `ara.traineddata` are bundled from npm and served from the app's own origin (CSP `connect-src 'self'`), so there's no third-party CDN and it works offline after the first use.
- After OCR, these fixes are applied: `»` that follows an Arabic word becomes `،`, and runs of spaces are collapsed.
- **The user's PDFs are copyrighted, so they're never committed.** Tests on them run only locally, from `/home/claude/samples/user`. CI uses generated fixtures.
- The OCR model downloads once after the user confirms (size shown), then is cached offline. If the user declines, broken pages stay as page images.
- OCR queue: the pages from the reading position to 5 pages ahead go first, then the rest of the book in order. OCR runs in a Web Worker at about 2× screen resolution, one page at a time, and pauses while the screen is hidden.
- Results are cached per page in IndexedDB (`ocr` store, keyed `bookId/page`, with the engine version). OCR'd pages produce normal text blocks (`s{page-1}b{n}`).
- `PARSER_VERSION` → 3.

- Built (and different from the plan): pages are classified on the **reassembled** line text, not the raw PDF items, because good Arabic PDFs store one glyph per item and would look like single-letter junk. An extra `broken` rule catches control characters over 2% (glyph ids leaking from fonts with no ToUnicode map). All 295 pages of user PDF A and all 62 pages of PDF B are routed to OCR.
- Placeholders get their final aspect ratio before any page image is drawn, so the layout never shifts. Native scroll anchoring is off in the text column, and swaps are compensated manually.

## Known gaps (follow-ups)
- **Scanned English pages:** OCR uses the Arabic model only, so English scans come out as junk. The fix would be to add `eng` and keep whichever of `ara` or `eng` reports higher confidence per page; that costs a few MB more. Good English PDFs are unaffected.
- PaddleOCR comparison (see the OCR engine decision above).

## Non-goals
- Handwriting, OCR of pictures inside EPUBs, preserving table or column layout, and maths.
- Editing or correcting OCR text in the app.
- Languages beyond Arabic and English for now.

## Test seams
- `classifyPage` and `orderLine`: pure unit tests.
- `OcrQueue`, with an injected fake `OcrEngine`: tests for ordering and caching.
- The engine comparison is a script (`scripts/ocr-bakeoff.mjs`) run on the user's PDF; it is not part of CI.

## Acceptance criteria
1. A new fixture, `arabic-good.pdf` (Arabic HTML printed to PDF by headless Chrome, with a font that has a correct ToUnicode map), opens with every page classified `ok`. Its text matches the source sentences exactly, in right-to-left word order and with no presentation-form characters.
2. A new fixture, `arabic-broken.pdf` (the same pages with the font's ToUnicode map removed), has every page classified `broken`. `scanned.pdf` is classified `empty` and now opens instead of being rejected.
3. Mixed English and Arabic lines in `arabic-good.pdf` keep the English words in their correct places.
4. With the fake engine at reading position page 10, the OCR order starts with pages 10–15 and then continues from page 1. A page already in the cache is never sent to OCR again.
5. In the reader, a broken page shows its page image with "Reading page…" until OCR finishes, then switches to text in place without the scroll position jumping.
6. Local check on the user's PDFs: `classifyPage` marks pages a8, a50 and a125 `broken`, all pages of b `empty`, and page a2 not `ok`. OCR of a8 and b20 in the browser gives no Latin letters, no `�`, and at least 95% Arabic-script words. The page a8 title line comes out exactly as printed.
7. On a phone-sized view, one page of OCR finishes in under 15 s with the Chrome CPU throttled ×4.
8. In airplane mode, after the model is cached, OCR still runs on a newly imported broken PDF.
9. Text pages of good PDFs and all non-PDF formats keep their spec 01 and 01b behaviour; the snapshot tests stay green.
