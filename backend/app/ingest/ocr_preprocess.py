"""OpenCV preprocessing for scanned statements before OCR.

Pipeline: grayscale → deskew (minAreaRect on text mass) → denoise →
adaptive threshold. Each step is conservative — bank statements are
usually flat-bed scans, not photos; over-processing hurts Tesseract.
"""

import cv2
import numpy as np


def deskew(gray: np.ndarray, max_angle: float = 8.0) -> np.ndarray:
    """Rotate so text lines are horizontal. Skips extreme angles (layout
    detection would have failed anyway)."""
    inverted = cv2.bitwise_not(gray)
    thresh = cv2.threshold(inverted, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]
    coords = np.column_stack(np.where(thresh > 0))
    if len(coords) < 100:
        return gray
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle
    if abs(angle) < 0.2 or abs(angle) > max_angle:
        return gray
    h, w = gray.shape[:2]
    matrix = cv2.getRotationMatrix2D((w // 2, h // 2), angle, 1.0)
    return cv2.warpAffine(gray, matrix, (w, h), flags=cv2.INTER_CUBIC,
                          borderMode=cv2.BORDER_REPLICATE)


def remove_table_rules(gray: np.ndarray, min_len: int = 60) -> np.ndarray:
    """Paint out long horizontal/vertical strokes (table grid lines).

    Ruled statement tables wreck Tesseract's line segmentation — with rules
    removed, each transaction row OCRs as one clean text line.
    """
    binv = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    horiz = cv2.morphologyEx(binv, cv2.MORPH_OPEN,
                             cv2.getStructuringElement(cv2.MORPH_RECT, (min_len, 1)))
    vert = cv2.morphologyEx(binv, cv2.MORPH_OPEN,
                            cv2.getStructuringElement(cv2.MORPH_RECT, (1, min_len)))
    clean = gray.copy()
    clean[(horiz > 0) | (vert > 0)] = 255
    return clean


def preprocess(image_bgr: np.ndarray) -> np.ndarray:
    """Full chain: gray → deskew → denoise → rule removal.

    Returns grayscale (not binarized): Tesseract's internal Otsu handles
    clean scans better than a fixed adaptive threshold, which was measured
    to destroy small table text.
    """
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY) if image_bgr.ndim == 3 else image_bgr
    gray = deskew(gray)
    gray = cv2.fastNlMeansDenoising(gray, h=10)
    return remove_table_rules(gray)
