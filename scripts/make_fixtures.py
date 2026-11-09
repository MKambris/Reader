#!/usr/bin/env python3
"""Regenerate tests/fixtures/. Needs: pandoc, calibre (ebook-convert), reportlab, Pillow.

Usage: python3 scripts/make_fixtures.py
"""
import email.charset
import os
import shutil
import struct
import subprocess
import tempfile
import zipfile
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "fixtures"
TITLE = "Fixture Book"
AUTHOR = "Test Author"

CHAPTERS = [
    ("Chapter One", [
        "It was a bright cold day in April, and the clocks were striking thirteen.",
        "The hallway smelt of boiled cabbage and old rag mats. At one end of it a coloured poster had been tacked to the wall.",
    ]),
    ("Chapter Two", [
        "The second chapter begins here with a sentence that is long enough to wrap.",
        "A final paragraph closes the book.",
    ]),
]

ARTICLE_BODY = [
    "Researchers announced today that reading aloud improves comprehension for many listeners.",
    "The study followed two hundred participants over six months and measured recall after each session.",
    "Participants who listened while following the text remembered noticeably more than those who only read silently.",
    "The authors caution that the effect varied widely between individuals and between kinds of material.",
]
NAV_TEXT = ["Home", "World", "Technology", "Subscribe now"]
FOOTER_TEXT = ["Privacy policy", "Terms of service", "Contact us"]


ILLUSTRATION_ALT = "A small illustration"
CHART_ALT = "A chart of recall scores"
IMG_URL = "https://news.example.com/chart.png"
# 1x1 transparent GIF: a classic spacer image that must be skipped.
SPACER_GIF = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"


def png_bytes(w=160, h=100, seed=1) -> bytes:
    """A PNG comfortably over 512 bytes (noisy gradient), so it isn't mistaken for a spacer."""
    import io
    import random
    from PIL import Image
    rnd = random.Random(seed)
    img = Image.new("RGB", (w, h))
    img.putdata([(x * 255 // w, y * 255 // h, rnd.randrange(256)) for y in range(h) for x in range(w)])
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def run(*cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def book_markdown(image_path=None):
    lines = [f"---\ntitle: {TITLE}\nauthor: {AUTHOR}\n---\n"]
    for ci, (heading, paras) in enumerate(CHAPTERS):
        lines.append(f"# {heading}\n")
        for pi, p in enumerate(paras):
            lines.append(p + "\n")
            # One illustration between the two paragraphs of Chapter One.
            if image_path and ci == 0 and pi == 0:
                lines.append(f"![{ILLUSTRATION_ALT}]({image_path}){{.illustration}}\n")
    return "\n".join(lines)


def article_html(img_src=None):
    nav = "".join(f'<li><a href="/{t.lower()}">{t}</a></li>' for t in NAV_TEXT)
    foot = "".join(f'<a href="/{i}">{t}</a> ' for i, t in enumerate(FOOTER_TEXT))
    import base64
    if img_src is None:
        img_src = "data:image/png;base64," + base64.b64encode(png_bytes(seed=2)).decode()
    paras = [f"<p>{p}</p>" for p in ARTICLE_BODY]
    # Photo after the second paragraph; a 1x1 spacer after the third.
    paras.insert(2, f'<figure><img src="{img_src}" alt="{CHART_ALT}" width="160" height="100"></figure>')
    paras.insert(4, f'<p><img src="data:image/gif;base64,{SPACER_GIF}" width="1" height="1" alt="">')
    body = "".join(paras)
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Reading Aloud Helps, Study Finds</title></head>
<body>
<header><nav><ul>{nav}</ul></nav></header>
<aside class="ad">Advertisement: Buy the best headphones today</aside>
<main><article>
<h1>Reading Aloud Helps, Study Finds</h1>
<p class="byline">By Jane Reporter</p>
{body}
</article></main>
<footer>{foot}</footer>
</body></html>
"""


def mhtml_from_html(html: str, images: dict | None = None) -> bytes:
    # Mirrors Chrome "Saved by Blink" layout: multipart/related, quoted-printable HTML part.
    msg = MIMEMultipart("related", type="text/html")
    msg["From"] = "<Saved by Blink>"
    msg["Snapshot-Content-Location"] = "https://news.example.com/reading-aloud"
    msg["Subject"] = "Reading Aloud Helps, Study Finds"
    cs = email.charset.Charset("utf-8")
    cs.body_encoding = email.charset.QP
    part = MIMEText(html, "html", cs)
    part["Content-Location"] = "https://news.example.com/reading-aloud"
    msg.attach(part)
    css = MIMEText("body{font-family:serif}", "css")
    css["Content-Location"] = "https://news.example.com/style.css"
    msg.attach(css)
    from email.mime.image import MIMEImage
    for url, data in (images or {}).items():
        img = MIMEImage(data, "png")
        img["Content-Location"] = url
        msg.attach(img)
    return msg.as_bytes()


def make_pdf(path: Path):
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas

    c = canvas.Canvas(str(path), pagesize=letter)
    c.setTitle(TITLE)
    c.setAuthor(AUTHOR)
    for heading, paras in CHAPTERS:
        y = 720
        c.setFont("Helvetica-Bold", 18)
        c.drawString(72, y, heading)
        y -= 40
        c.setFont("Helvetica", 12)
        for p in paras:
            words, line = p.split(), ""
            for w in words:
                if len(line) + len(w) > 70:
                    c.drawString(72, y, line.strip())
                    y -= 16
                    line = ""
                line += w + " "
            c.drawString(72, y, line.strip())
            y -= 36  # paragraph gap
        c.showPage()
    c.save()


def make_long_pdf(path: Path, pages: int):
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas

    c = canvas.Canvas(str(path), pagesize=letter)
    c.setTitle("Long Fixture")
    for i in range(1, pages + 1):
        c.setFont("Helvetica-Bold", 18)
        c.drawString(72, 720, f"Page heading {i}")
        c.setFont("Helvetica", 12)
        c.drawString(72, 680, f"This is the body text of page {i}.")
        c.showPage()
    c.save()


def make_scanned_pdf(path: Path):
    from PIL import Image, ImageDraw
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas

    img = Image.new("RGB", (1200, 400), "white")
    ImageDraw.Draw(img).text((40, 40), "This page is only an image of text.", fill="black")
    tmp = path.with_suffix(".png")
    img.save(tmp)
    c = canvas.Canvas(str(path), pagesize=letter)
    c.setTitle("Scanned")
    c.drawImage(str(tmp), 36, 400, width=540, height=180)
    c.showPage()
    c.save()
    tmp.unlink()


def rewrite_zip(src: Path, dst: Path, edit):
    """Copy an EPUB zip, letting edit(name, data) -> data|None change entries; keeps mimetype first/stored."""
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w") as zout:
        for info in zin.infolist():
            data = edit(info.filename, zin.read(info.filename))
            ctype = zipfile.ZIP_STORED if info.filename == "mimetype" else zipfile.ZIP_DEFLATED
            zout.writestr(info.filename, data, compress_type=ctype)
        extra = edit(None, None)
        for name, data in (extra or {}).items():
            zout.writestr(name, data, compress_type=zipfile.ZIP_DEFLATED)


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        (td / "illustration.png").write_bytes(png_bytes(seed=1))
        md = td / "book.md"
        md.write_text(book_markdown("illustration.png"))
        cwd = os.getcwd()
        os.chdir(td)  # pandoc resolves the image path relative to cwd
        try:
            run("pandoc", str(md), "-o", str(OUT / "book.epub"))
            run("pandoc", str(md), "-o", str(OUT / "book.docx"))
            run("pandoc", str(md), "-o", str(OUT / "book.fb2"))
        finally:
            os.chdir(cwd)
        run("ebook-convert", str(OUT / "book.epub"), str(OUT / "book.mobi"), "--mobi-file-type", "old")
        run("ebook-convert", str(OUT / "book.epub"), str(OUT / "book.azw3"))

    (OUT / "book.txt").write_text(
        "\n\n".join([TITLE] + [h + "\n\n" + "\n\n".join(ps) for h, ps in CHAPTERS]) + "\n"
    )
    make_pdf(OUT / "book.pdf")
    make_scanned_pdf(OUT / "scanned.pdf")

    html = article_html()
    (OUT / "article.html").write_text(html)
    # MHTML: the photo is a separate MIME part referenced by URL, like Chrome saves it.
    (OUT / "article.mhtml").write_bytes(
        mhtml_from_html(article_html(img_src=IMG_URL), {IMG_URL: png_bytes(seed=2)}))
    make_long_pdf(OUT / "long.pdf", pages=20)

    # DRM EPUB: encryption.xml with a real (non-font-obfuscation) cipher.
    enc = b"""<?xml version="1.0"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
  xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
 <enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/>
  <enc:CipherData><enc:CipherReference URI="EPUB/text/ch001.xhtml"/></enc:CipherData></enc:EncryptedData>
</encryption>"""
    rewrite_zip(OUT / "book.epub", OUT / "drm.epub",
                lambda n, d: {"META-INF/encryption.xml": enc} if n is None else d)

    # DRM MOBI: set the PalmDOC encryption field (record 0, offset 12) to 2 (Mobipocket DRM).
    data = bytearray((OUT / "book.mobi").read_bytes())
    rec0 = struct.unpack(">I", data[78:82])[0]
    struct.pack_into(">H", data, rec0 + 12, 2)
    (OUT / "drm.mobi").write_bytes(bytes(data))

    # Script EPUB: inject a script into every chapter document.
    def inject(n, d):
        if n is None:
            return None
        if n.endswith(".xhtml") and b"<body" in d:
            return d.replace(b"</body>", b"<script>window.__pwned = 1;</script></body>")
        return d
    rewrite_zip(OUT / "book.epub", OUT / "script.epub", inject)

    # Ruby + JPEG-in-spine EPUB: furigana must not duplicate text; an image spine item must not crash.
    from PIL import Image
    import io
    jpg = io.BytesIO()
    Image.new("RGB", (64, 64), "gray").save(jpg, "JPEG")
    ruby_page = ('<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml">'
                 '<head><title>r</title></head><body><p><ruby>山路<rt>やまみち</rt></ruby>を登りながら、'
                 '<ruby>漢<rp>(</rp><rt>かん</rt><rp>)</rp></ruby>字。</p></body></html>').encode()
    def ruby_and_jpeg(n, d):
        if n is None:
            svg_page = ('<?xml version="1.0" encoding="UTF-8"?>\n<!-- ' + 'x' * 1200 + ' -->\n'
                        '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#8ac"/></svg>').encode()
            return {"EPUB/text/ruby.xhtml": ruby_page, "EPUB/media/page.jpg": jpg.getvalue(), "EPUB/media/page.svg": svg_page}
        if n.endswith("content.opf"):
            d = d.replace(b"</manifest>",
                          b'<item id="rubypage" href="text/ruby.xhtml" media-type="application/xhtml+xml"/>'
                          b'<item id="jpgpage" href="media/page.jpg" media-type="image/jpeg"/>'
                          b'<item id="svgpage" href="media/page.svg" media-type="image/svg+xml"/></manifest>')
            d = d.replace(b"</spine>", b'<itemref idref="jpgpage"/><itemref idref="rubypage"/><itemref idref="svgpage"/></spine>')
        return d
    rewrite_zip(OUT / "book.epub", OUT / "ruby-jpeg-spine.epub", ruby_and_jpeg)

    # SVG-script EPUB: an <img>-referenced SVG and an inline SVG, both carrying scripts.
    svg = (b'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">'
           b'<script>window.__pwned = 1;</script>'
           b'<rect width="200" height="100" fill="#3a7"/><circle cx="100" cy="50" r="40" fill="#fc3"/>'
           b'<text x="20" y="90" font-size="14">An SVG picture with a script inside it</text></svg>')
    def svg_inject(n, d):
        if n is None:
            return {"EPUB/media/evil.svg": svg}
        if n.endswith("content.opf"):
            d = d.replace(b"</manifest>",
                          b'<item id="evilsvg" href="media/evil.svg" media-type="image/svg+xml"/></manifest>')
        if n.endswith("ch001.xhtml"):
            d = d.replace(b"</body>", b'<p><img src="../media/evil.svg" alt="Evil SVG"/></p>' + svg + b"</body>")
        return d
    rewrite_zip(OUT / "book.epub", OUT / "svg-script.epub", svg_inject)

    for p in sorted(OUT.iterdir()):
        print(f"{p.name:16} {p.stat().st_size:>8}")


if __name__ == "__main__":
    main()
