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


def run(*cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def book_markdown():
    lines = [f"---\ntitle: {TITLE}\nauthor: {AUTHOR}\n---\n"]
    for heading, paras in CHAPTERS:
        lines.append(f"# {heading}\n")
        lines.extend(p + "\n" for p in paras)
    return "\n".join(lines)


def article_html():
    nav = "".join(f'<li><a href="/{t.lower()}">{t}</a></li>' for t in NAV_TEXT)
    foot = "".join(f'<a href="/{i}">{t}</a> ' for i, t in enumerate(FOOTER_TEXT))
    body = "".join(f"<p>{p}</p>" for p in ARTICLE_BODY)
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


def mhtml_from_html(html: str) -> bytes:
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
        md = td / "book.md"
        md.write_text(book_markdown())
        run("pandoc", str(md), "-o", str(OUT / "book.epub"))
        run("pandoc", str(md), "-o", str(OUT / "book.docx"))
        run("pandoc", str(md), "-o", str(OUT / "book.fb2"))
        run("ebook-convert", str(OUT / "book.epub"), str(OUT / "book.mobi"), "--mobi-file-type", "old")
        run("ebook-convert", str(OUT / "book.epub"), str(OUT / "book.azw3"))

    (OUT / "book.txt").write_text(
        "\n\n".join([TITLE] + [h + "\n\n" + "\n\n".join(ps) for h, ps in CHAPTERS]) + "\n"
    )
    make_pdf(OUT / "book.pdf")
    make_scanned_pdf(OUT / "scanned.pdf")

    html = article_html()
    (OUT / "article.html").write_text(html)
    (OUT / "article.mhtml").write_bytes(mhtml_from_html(html))

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

    for p in sorted(OUT.iterdir()):
        print(f"{p.name:16} {p.stat().st_size:>8}")


if __name__ == "__main__":
    main()
