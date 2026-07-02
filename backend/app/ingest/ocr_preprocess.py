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


def preprocess(image_bgr: np.ndarray) -> np.ndarray:
    """Full preprocessing chain; returns a binarized image for OCR."""
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY) if image_bgr.ndim == 3 else image_bgr
    gray = deskew(gray)
    gray = cv2.fastNlMeansDenoising(gray, h=10)
    return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                 cv2.THRESH_BINARY, 31, 15)
