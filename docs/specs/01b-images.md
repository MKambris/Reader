# Spec 01b — Images

**Amends:** Spec 01. **Affects:** Spec 02, where narration skips image blocks.

## Problem
The reader shows only text, so covers, illustrations, diagrams and article photos are lost. PDFs, where the layout often matters, can only be read as reflowed text.

## Solution
Pictures appear in their place between paragraphs for EPUB, MOBI, AZW3, FB2, DOCX and saved web pages. PDFs get a "Page view" toggle that shows the original pages; switching back keeps your place.

## Decisions
- The `Block` type becomes `{ id, kind: 'text', text } | { id, kind: 'image', blob, alt }`. Image blocks get their own ids (`s{section}i{n}`), so **text block ids don't change** and saved positions stay valid.
- Image bytes are stored as Blobs inside the cached `Doc` in IndexedDB, so they work offline and are deleted with the book. They are shown with `URL.createObjectURL`, and those URLs are revoked when the reader closes.
- Image sources: EPUB and FB2 resources from the archive, MOBI/AZW3 image records, DOCX images embedded by mammoth, HTML `data:` images, and MHTML parts matched by `Content-Location`.
- Spacer images are skipped: Blobs under 512 bytes, or images whose declared width or height is 16 px or less.
- Images are always shown with `<img>` (alt text, `max-width: 100%`). SVG is also shown through `<img>`, so any scripts inside it can't run.
- PDF Page view uses PDF.js to draw each page onto a canvas at screen width. Only pages within one screen of the visible area are drawn; the rest are placeholders. Page N corresponds to section `s{N-1}`.
- `PARSER_VERSION` → 2, so existing library items re-parse on next open.

## Non-goals
- Images in plain `.html` files that point to separate files (for example `page_files/x.png`). Only images built into the file (`data:` images) can be shown; use `.mhtml` for complete saved pages.
- Zooming, panning or tapping to enlarge images.
- Reading alt text aloud, or highlighting the spoken sentence in Page view.
- Pulling individual images out of PDFs in text view.

## Test seam
Same as spec 01: `openDocument(file)`. Page view is checked in the browser test (`scripts/smoke.mjs`).

## Acceptance criteria
1. The fixtures are regenerated with one PNG illustration between the two paragraphs of Chapter One. For EPUB, MOBI, AZW3, FB2 and DOCX, `openDocument` returns exactly one image block at that position, with a Blob whose `type` starts with `image/`.
2. The article fixture gains an `<img src="data:image/png;base64,…">` inside its body, and the MHTML fixture stores the same image as a separate part. Both return one image block with the alt text from the HTML.
3. A 1×1 spacer GIF in the article fixture produces no image block.
4. For every fixture, the list of text block ids and their text is identical to what spec 01's parser produced (checked against snapshots recorded before this change).
5. In the reader, each image block shows as an `<img>` between the correct neighbouring paragraphs, no wider than the text column.
6. An EPUB fixture containing an SVG with `<script>window.__pwned=1</script>` displays, and `window.__pwned` stays undefined.
7. A "Page view" button appears only for PDFs. Tapping it shows the original pages, starting at the page containing the paragraph that was at the top of the screen. Tapping "Text view" returns to the first paragraph of the page that was at the top in Page view.
8. In Page view on a 20-page PDF, no more than 5 page canvases exist at any time while scrolling.
9. A book imported before this change (parser version 1) opens at its saved paragraph after it re-parses.
10. In airplane mode, images and Page view work for previously imported books.
