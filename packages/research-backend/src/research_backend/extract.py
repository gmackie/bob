"""Text extraction from various source formats."""

from __future__ import annotations

from pathlib import Path


def extract_text(path: Path) -> tuple[str, str]:
    """Extract text from a file. Returns (text, mime_type)."""
    suffix = path.suffix.lower()

    if suffix == ".pdf":
        return _extract_pdf(path), "application/pdf"
    elif suffix in (".md", ".markdown", ".txt"):
        return path.read_text(encoding="utf-8"), "text/markdown"
    elif suffix in (".html", ".htm"):
        return _extract_html(path), "text/html"
    else:
        raise ValueError(f"Unsupported file type: {suffix}. Supported: .pdf, .md, .txt, .html")


def _extract_pdf(path: Path) -> str:
    """Extract text from PDF using PyMuPDF."""
    try:
        import fitz
    except ImportError:
        raise ImportError("PyMuPDF (fitz) required for PDF extraction. Install with: pip install pymupdf")

    doc = fitz.open(str(path))
    pages = []
    for page in doc:
        pages.append(page.get_text())
    doc.close()
    return "\n\n".join(pages)


def _extract_html(path: Path) -> str:
    """Extract text from HTML, stripping tags."""
    import re
    html = path.read_text(encoding="utf-8")
    text = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL)
    text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text
