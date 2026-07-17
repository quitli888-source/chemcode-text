#!/usr/bin/env python3
"""
Local PDF text extractor (NO external LLM, fully offline).

Uses PyMuPDF (fitz) which is a pure-Python binding to the local MuPDF engine.
- For normal PDFs with a text layer: extracts text directly (fast, accurate).
- For scanned/image-only pages: if the Tesseract OCR binary is installed on
  the machine, it is invoked via pytesseract to OCR that page. If Tesseract is
  not installed, the page is reported as unscanned-capable (the pipeline does
  not fail — it just notes the gap).

Output: Markdown-structured plain text to stdout (or to --out .md file).
All pages are processed — NO truncation.

Usage:
  python pdf_extract.py <input.pdf> [--out output.md] [--lang chi_sim+eng]
"""
import sys
import os
import io
import argparse

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.stderr.write("ERROR: PyMuPDF (fitz) is not installed. Run: pip install pymupdf\n")
    sys.exit(2)

# pytesseract is optional — only needed for scanned-page OCR.
try:
    import pytesseract
    from PIL import Image
    _HAVE_TESSERACT = True
except ImportError:
    _HAVE_TESSERACT = False


def _tesseract_available() -> bool:
    """Check whether the Tesseract binary is reachable on PATH."""
    if not _HAVE_TESSERACT:
        return False
    try:
        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


def extract_page_text(page, lang: str) -> str:
    """Extract text from a single page. Uses text layer; OCRs if empty."""
    # Prefer the embedded text layer (preserves structure, fast).
    blocks = page.get_text("blocks")
    # blocks: (x0, y0, x1, y1, text, block_no, block_type)
    text_blocks = [b for b in blocks if b[4] and b[4].strip()]
    text_blocks.sort(key=lambda b: (round(b[1]), round(b[0])))
    text = "\n".join(b[4].strip() for b in text_blocks).strip()

    if text:
        return text

    # No text layer -> this page is scanned/image-only. Try local OCR.
    if _tesseract_available():
        try:
            pix = page.get_pixmap(dpi=300)
            img = Image.open(io.BytesIO(pix.tobytes("png")))
            ocr_text = pytesseract.image_to_string(img, lang=lang).strip()
            if ocr_text:
                return ocr_text
        except Exception as e:
            return f"[OCR failed on this page: {e}]"
        return "[scanned page — OCR returned no text]"
    else:
        return ("[scanned page — text layer empty and Tesseract OCR is not "
                "installed on this machine; install Tesseract to OCR scans]")


def extract_pdf(pdf_path: str, lang: str) -> str:
    if not os.path.isfile(pdf_path):
        sys.stderr.write(f"ERROR: file not found: {pdf_path}\n")
        sys.exit(1)

    doc = fitz.open(pdf_path)
    parts = []
    total = doc.page_count
    for i in range(total):
        page = doc.load_page(i)
        txt = extract_page_text(page, lang)
        # Page heading for the markdown output.
        parts.append(f"<!-- Page {i + 1} / {total} -->\n\n{txt}")
    doc.close()

    return "\n\n---\n\n".join(parts).strip()


def main():
    ap = argparse.ArgumentParser(description="Local PDF text extractor (PyMuPDF).")
    ap.add_argument("pdf", help="Path to the input PDF file")
    ap.add_argument("--out", help="Optional output .md file path (default: stdout)")
    ap.add_argument("--lang", default="chi_sim+eng",
                    help="Tesseract language(s) for scanned-page OCR (default: chi_sim+eng)")
    args = ap.parse_args()

    text = extract_pdf(args.pdf, args.lang)

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text)
        sys.stderr.write(f"Wrote {len(text)} chars to {args.out}\n")
    else:
        sys.stdout.write(text)


if __name__ == "__main__":
    main()
