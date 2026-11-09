# Spec 01 — Library & formats

**Part of:** Reader (glasses read-aloud app). Order: 01 → 02 → 03.

## Problem
My books and articles are saved as files in mixed formats. I need one app on my Android phone that opens all of them, remembers where I am, and turns each into clean text that can later be read aloud.

## Solution
An installable web app (PWA) for Android Chrome. I import files from the phone and they go into a local library. Opening any item shows readable, reflowed text and saves my position automatically. Inside the app every format becomes one shared document model, and specs 02 and 03 build on that model.

## Decisions
- Platform: PWA in Android Chrome. The RayNeo Air 3 mirrors the phone over USB-C, so it needs no glasses-specific code.
- Stack: Vite + TypeScript. foliate-js reads EPUB, MOBI, AZW3 and FB2, PDF.js reads PDF, and mammoth reads DOCX. TXT and HTML are parsed natively; HTML is cleaned with Readability. MHTML/MHT (Chrome's saved-page format) is unpacked by the app's own MIME-multipart reader: it takes the first `text/html` part, decodes quoted-printable or base64, then hands it to the HTML path.
- Books and articles both come from local files, so there is no URL fetching and no server.
- Storage stays on the device in IndexedDB: the files, their metadata and the reading position. There is no account and no sync.
- On first import the app calls `navigator.storage.persist()`, so Android doesn't evict the library under storage pressure.
- The parsed `Doc` is cached alongside the file and keyed by `PARSER_VERSION`. Position is saved as `{ blockId, fraction }`. If the parser version changes, the book is re-parsed, and if the saved `blockId` no longer exists, the app falls back to `fraction`.
- foliate-js has no releases and an unstable API, so it is vendored as a git submodule pinned to one commit. Only its format modules (`epub.js`, `mobi.js`, `fb2.js`) are used, through `section.createDocument()`. Its renderer is not used.
- Block text is put on screen as text only (`textContent`), never `innerHTML`, so scripts embedded in a book or saved page can't run.
- DRM is detected by the app itself, because foliate-js doesn't report it. For MOBI/AZW3, the encryption field in the record-0 header must be non-zero. For EPUB, `META-INF/encryption.xml` must list any algorithm other than font obfuscation, or `rights.xml` must be present.

## Non-goals
- DRM-protected files (Kindle store AZW, Adobe DRM EPUB). These show an error; there is no workaround.
- Scanned PDFs without a text layer (OCR).
- Fetching articles from URLs, browser share targets, or cloud import.
- Syncing across devices, accounts, or a backend.
- Annotations, highlights, dictionary, or search.
- Rendering original PDF page layout. PDFs are shown as reflowed text.

## Test seam
`openDocument(file: File): Promise<Doc>`, where `Doc = { title, author?, sections: [{ title, blocks: [{ id, text }] }] }`. Tests run against fixture files in `tests/fixtures/` (one per format, plus one DRM sample and one scanned PDF).

## Acceptance criteria
1. Each fixture (EPUB, MOBI, AZW3, FB2, PDF, DOCX, TXT, HTML, MHTML) passed to `openDocument` returns a `Doc` with a non-empty title and at least one block. Each block's text contains no HTML tags.
2. Block IDs are stable: opening the same file twice gives identical ID lists.
3. For a DRM fixture, `openDocument` rejects with `DrmError`, and the UI shows "This file is DRM-protected and can't be opened."
4. For a PDF with no text layer, `openDocument` rejects with `NoTextError`, and the UI shows "This PDF has no readable text (scanned image)."
5. For the HTML article fixture (a saved web page with navigation, ads and a footer) and an MHTML fixture of the same page saved by Chrome on Android, the blocks contain the article body and none of the navigation or footer link text. The two fixtures produce identical block text, and the MHTML blocks contain no `=20` or `=\n` quoted-printable artifacts.
6. Importing from the library screen opens Android's file picker with no extension filter. Android greys out .azw3 and .fb2 when filtered, so the type is checked after a file is picked. A supported file appears in the library with its title and author. An unsupported file shows "Unsupported file type: .xyz" and is not added.
7. Close the app mid-book, reopen it, and tap the item: it opens at the same block that was at the top of the screen before closing.
8. Deleting a library item removes its file, cached `Doc` and position. After a reload it is gone, and IndexedDB has no records under its ID.
9. In airplane mode, once installed, the app launches, shows the library, and opens previously imported items.
10. Android Chrome offers "Install app" for the site (the manifest is valid, a service worker is registered, and `beforeinstallprompt` fires). Lighthouse no longer audits PWAs, so it isn't used for this check.
11. After the first import, `navigator.storage.persisted()` returns `true`, or, if the browser refused, the library screen shows a one-line warning that Android may clear the library when storage is low.
12. Opening a book whose cached `Doc` has an older `PARSER_VERSION` re-parses it. If the saved `blockId` is missing, the book opens at the block nearest the saved `fraction`.
13. An EPUB fixture that contains a `<script>` that sets `window.__pwned = 1` opens normally, and `window.__pwned` stays undefined.
