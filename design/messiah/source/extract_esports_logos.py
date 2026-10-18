"""Extract the eight vector esports marks from page 51 of Messiah's 2026 guide.

Run with PyMuPDF installed (python -m pip install pymupdf). The output is
clipped directly from the source PDF, retaining vector paths in each SVG.
The dark-background samples intentionally include the guide's blue field.
"""

from pathlib import Path
import json
import pymupdf

ROOT = Path(__file__).resolve().parents[1]
PDF = ROOT / "source" / "Athletics_Brad_Identity_Guide_Updated.pdf"
OUT = ROOT / "assets" / "guide"
PAGE_INDEX = 13

MARKS = [
    ("logo-primary-light", "Esports primary logo for a light-colored background", (79, 289, 172, 376), "light", "logo"),
    ("logo-blue-white", "Esports logo in blue and white", (199, 289, 293, 376), "light", "logo"),
    ("logo-black-white", "Esports logo for black-and-white printing", (320, 289, 414, 376), "print", "logo"),
    ("logo-dark-background", "Esports logo on a dark-colored background", (432, 283, 540, 383), "dark sample with blue field", "logo"),
    ("wordmark-primary-light", "Esports wordmark for a light-colored background", (81, 451, 173, 474), "light", "wordmark"),
    ("wordmark-blue-white", "Esports wordmark in blue and white", (199, 451, 293, 474), "light", "wordmark"),
    ("wordmark-black-white", "Esports wordmark for black-and-white printing", (320, 451, 413, 474), "print", "wordmark"),
    ("wordmark-dark-background", "Esports wordmark on a dark-colored background", (432, 443, 540, 485), "dark sample with blue field", "wordmark"),
]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    source = pymupdf.open(PDF)
    assert len(source) > PAGE_INDEX
    manifest = {
        "source": "https://s3.us-east-2.amazonaws.com/sidearm.nextgen.sites/messiah.sidearmsports.com/documents/2026/2/26/Athletics_Brad_Identity_Guide_Updated.pdf",
        "page": 51,
        "pdfPageIndex": PAGE_INDEX,
        "method": "Vector clip from PDF page; transparent PNG preview at 720 dpi; no redrawing or recoloring.",
        "note": "The two dark-background samples include the blue rectangle printed behind the mark in the guide. Request source artwork and permission from Messiah Athletics for production usage.",
        "marks": [],
    }
    for name, label, box, use, kind in MARKS:
        clip = pymupdf.Rect(*box)
        doc = pymupdf.open()
        page = doc.new_page(width=clip.width, height=clip.height)
        page.show_pdf_page(page.rect, source, PAGE_INDEX, clip=clip)
        (OUT / f"{name}.svg").write_text(page.get_svg_image(), encoding="utf-8")
        page.get_pixmap(matrix=pymupdf.Matrix(10, 10), alpha=True).save(OUT / f"{name}.png")
        manifest["marks"].append({
            "id": name,
            "label": label,
            "kind": kind,
            "use": use,
            "svg": f"{name}.svg",
            "png": f"{name}.png",
            "sourceClipPoints": list(box),
        })
        doc.close()
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    source.close()


if __name__ == "__main__":
    main()
