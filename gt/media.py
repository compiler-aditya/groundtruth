"""Image loading, encoding, tiling and de-duplication helpers."""

from __future__ import annotations

import base64
import io
import re
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"}


def expand_inputs(items: list[str]) -> list[str]:
    """Turn a mix of files, directories and URLs into a flat list of image sources."""
    sources: list[str] = []
    for item in items:
        path = Path(item)
        if item.startswith(("http://", "https://")):
            sources.append(item)
        elif path.is_dir():
            sources.extend(str(p) for p in sorted(path.iterdir()) if p.suffix.lower() in IMAGE_EXTS)
        elif path.is_file():
            sources.append(str(path))
        else:
            raise SystemExit(f"Not found: {item}")
    if not sources:
        raise SystemExit("No images found in the inputs given.")
    return sources


def load_image(source: str) -> Image.Image:
    """Load a local path or URL, applying EXIF rotation.

    SAM and Spark both work in displayed pixels (after EXIF rotation), so every
    image is rotated here and re-encoded before it is sent. That keeps the
    coordinates the models return aligned with the overlays drawn locally.
    """
    if source.startswith(("http://", "https://")):
        request = urllib.request.Request(source, headers={"User-Agent": "groundtruth-day1"})
        with urllib.request.urlopen(request, timeout=60) as response:
            image = Image.open(io.BytesIO(response.read()))
    else:
        image = Image.open(source)
    return ImageOps.exif_transpose(image).convert("RGB")


def fit_long_side(image: Image.Image, max_side: int) -> Image.Image:
    if max(image.size) <= max_side:
        return image
    scale = max_side / max(image.size)
    return image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)


def to_data_url(image: Image.Image, fmt: str = "JPEG", quality: int = 90) -> str:
    buffer = io.BytesIO()
    if fmt == "JPEG":
        image.save(buffer, "JPEG", quality=quality)
        mime = "image/jpeg"
    else:
        image.save(buffer, "PNG")
        mime = "image/png"
    return f"data:{mime};base64,{base64.b64encode(buffer.getvalue()).decode()}"


def file_data_url(path: Path, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:48] or "item"


@dataclass
class Tile:
    x0: int
    y0: int
    image: Image.Image


def make_tiles(image: Image.Image, grid: int, overlap: float) -> list[Tile]:
    """Split into a grid x grid set of overlapping tiles (grid=1 returns the whole image)."""
    if grid <= 1:
        return [Tile(0, 0, image)]
    width, height = image.size
    tile_w, tile_h = width / grid, height / grid
    pad_w, pad_h = tile_w * overlap, tile_h * overlap
    tiles = []
    for row in range(grid):
        for col in range(grid):
            x0 = max(0, int(col * tile_w - pad_w))
            y0 = max(0, int(row * tile_h - pad_h))
            x1 = min(width, int((col + 1) * tile_w + pad_w))
            y1 = min(height, int((row + 1) * tile_h + pad_h))
            tiles.append(Tile(x0, y0, image.crop((x0, y0, x1, y1))))
    return tiles


Box = tuple[float, float, float, float]


def iou(a: Box, b: Box) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    if inter == 0:
        return 0.0
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    # Containment counts as a duplicate: a detection cut by a tile edge is a
    # smaller box inside the full one from the neighbouring tile.
    return max(inter / (area_a + area_b - inter), inter / min(area_a, area_b))


def dedupe_boxes(items: list[dict], threshold: float = 0.6) -> list[dict]:
    """Greedy de-duplication of tile-overlap detections, keeping the larger box."""
    ordered = sorted(items, key=lambda d: (d["box"][2] - d["box"][0]) * (d["box"][3] - d["box"][1]), reverse=True)
    kept: list[dict] = []
    for item in ordered:
        if all(iou(item["box"], k["box"]) < threshold for k in kept):
            kept.append(item)
    return kept


def dedupe_points(points: list[tuple[float, float]], radius: float) -> list[tuple[float, float]]:
    kept: list[tuple[float, float]] = []
    for x, y in points:
        if all((x - kx) ** 2 + (y - ky) ** 2 > radius**2 for kx, ky in kept):
            kept.append((x, y))
    return kept


def norm_to_px(value: float, size: int) -> float:
    """Spark grounding uses a 0-1000 grid; clamp because edge objects can read 1001."""
    return min(max(value, 0), 1000) * size / 1000
