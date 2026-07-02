"""OCR extraction for scanned PDFs and photographed statements.

Engine strategy (plan.md Research §1): PaddleOCR PP-Structure is the
preferred engine when installed (better table recovery); Tesseract 5 is
the required baseline. Both optional imports degrade gracefully so the
backend runs on machines with neither (digital formats still work).

Output: text LINES with per-line confidence, fed into the same regex
line parser used for digital PDFs — one downstream path for everything.
"""

import shutil
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .ocr_preprocess import preprocess


@dataclass
class OcrLine:
    text: str
    confidence: float  # 0..1


class NoOcrEngine(Exception):
    pass


def tesseract_available() -> bool:
    return shutil.which("tesseract") is not None


def _paddle_engine():
    try:
        from paddleocr import PaddleOCR  # optional heavy dep

        return PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
    except ImportError:
        return None


_PADDLE = None
_PADDLE_TRIED = False


def ocr_image(image_bgr: np.ndarray) -> list[OcrLine]:
    """OCR one page image → lines with confidence."""
    global _PADDLE, _PADDLE_TRIED
    if not _PADDLE_TRIED:
        _PADDLE = _paddle_engine()
        _PADDLE_TRIED = True

    # Cap resolution — Tesseract accuracy collapses on oversized pages
    # (phone photos, DPI-less scans). ~3500px height ≈ 300 DPI A4.
    h, w = image_bgr.shape[:2]
    if max(h, w) > 3600:
        import cv2

        scale = 3600 / max(h, w)
        image_bgr = cv2.resize(image_bgr, (int(w * scale), int(h * scale)),
                               interpolation=cv2.INTER_AREA)

    processed = preprocess(image_bgr)

    if _PADDLE is not None:
        result = _PADDLE.ocr(processed)
        lines: list[OcrLine] = []
        for page in result or []:
            for entry in page or []:
                text, conf = entry[1][0], float(entry[1][1])
                lines.append(OcrLine(text, conf))
        return lines

    if tesseract_available():
        import pytesseract

        data = pytesseract.image_to_data(processed, output_type=pytesseract.Output.DICT,
                                         config="--psm 6")
        by_line: dict[tuple, list[tuple[str, float]]] = {}
        for i, word in enumerate(data["text"]):
            if not word.strip():
                continue
            key = (data["page_num"][i], data["block_num"][i], data["par_num"][i], data["line_num"][i])
            by_line.setdefault(key, []).append((word, float(data["conf"][i])))
        lines = []
        for parts in by_line.values():
            words = [w for w, _ in parts]
            confs = [c for _, c in parts if c >= 0]
            lines.append(OcrLine(" ".join(words), (sum(confs) / len(confs)) / 100 if confs else 0.0))
        return lines

    raise NoOcrEngine("no OCR engine: install tesseract (pacman -S tesseract) or paddleocr")


def pdf_pages_to_images(path: str | Path, dpi: int = 300) -> list[np.ndarray]:
    from pdf2image import convert_from_path

    pages = convert_from_path(str(path), dpi=dpi)
    return [np.array(p)[:, :, ::-1] for p in pages]  # PIL RGB → OpenCV BGR


def image_file_to_array(path: str | Path) -> np.ndarray:
    import cv2

    img = cv2.imread(str(path))
    if img is None:
        raise ValueError(f"unreadable image: {path}")
    return img
