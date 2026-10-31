"""Construction drawing sheets: Muse Spark 1.3 reads the title block and tags, and counts symbols.

Symbols are counted on the whole sheet by default, scaled so the image fits the API's decode limit: on a real
7177 px sheet, 2x2 tiles counted symbols near the seams twice (116 vs 104 fixtures) and the whole sheet did not.
"""

import pymupdf
from openai import OpenAI
from PIL import Image

from .media import Tile, fit_long_side, load_image, make_tiles
from .spark import Usage, count_points, image_part, structured, text_part

S = {"type": "string"}

TITLE_FIELDS = ("sheet_number", "drawing_number", "sheet_title", "discipline", "project_name", "date", "revision", "scale")

SHEET_SCHEMA = {
    "type": "object",
    "properties": {
        "title_block": {
            "type": "object",
            "properties": {k: S for k in TITLE_FIELDS},
            "required": list(TITLE_FIELDS),
            "additionalProperties": False,
        },
        "legend": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"symbol_description": S, "meaning": S},
                "required": ["symbol_description", "meaning"],
                "additionalProperties": False,
            },
        },
        "equipment_tags": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"tag": S, "description": S, "location_hint": S},
                "required": ["tag", "description", "location_hint"],
                "additionalProperties": False,
            },
        },
        "general_notes": {"type": "array", "items": S},
        "readability": {"type": "string", "enum": ["good", "partial", "poor"]},
        "issues": S,
    },
    "required": ["title_block", "legend", "equipment_tags", "general_notes", "readability", "issues"],
    "additionalProperties": False,
}

SHEET_PROMPT = (
    "These images are one construction drawing sheet: first the whole sheet, then a close-up of its right-hand "
    "strip where the title block usually is. Read the title block exactly as printed (empty string for any field "
    "that is not on the sheet). sheet_number is the short discipline sheet ID (e.g. E-101); drawing_number is the "
    "separate drawing or document number many title blocks also carry (e.g. NY 0514, 1234-E-002). List every legend entry, and every equipment or element tag that appears on the "
    "drawing (e.g. P-301A, MCC-2, door numbers, panel names) with what it labels and where on the sheet it is. "
    "Summarise each general note in one line. Do not guess text you cannot read; say so in issues."
)


LEGEND_RULE = (
    "This is part of a construction drawing. Count only symbols placed on the plan itself; do not count the "
    "sample symbols shown in a legend, symbol list, schedule, title block or notes."
)


def render_sheet(path: str, page: int, dpi: int) -> Image.Image:
    if path.lower().endswith(".pdf"):
        doc = pymupdf.open(path)
        if not 1 <= page <= doc.page_count:
            raise ValueError(f"{path} has {doc.page_count} page(s); --page {page} is out of range.")
        pix = doc[page - 1].get_pixmap(dpi=dpi)
        return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    return load_image(path)


def read_sheet(client: OpenAI, sheet: Image.Image, *, usage: Usage, effort: str = "medium") -> dict:
    """Title block, legend, tags and notes from the whole sheet plus a close-up of its right-hand strip."""
    overview = fit_long_side(sheet, 3072)
    strip = fit_long_side(sheet.crop((int(sheet.width * 0.75), 0, sheet.width, sheet.height)), 2048)
    return structured(client, [text_part(SHEET_PROMPT), image_part(overview), image_part(strip)], "sheet",
                      SHEET_SCHEMA, usage=usage, effort=effort)


def count_tiles(sheet: Image.Image, tiles: int = 1, max_side: int = 4096) -> tuple[Image.Image, list[Tile], float]:
    """Tiles of a copy scaled so each tile fits the image decode limit, and that scale."""
    overlap = 0.08 if tiles > 1 else 0.0
    tile_side = max(sheet.size) / tiles * (1 + overlap)
    scale = min(1.0, max_side / tile_side)
    scaled = sheet.resize((round(sheet.width * scale), round(sheet.height * scale)), Image.LANCZOS) if scale < 1 else sheet
    return scaled, make_tiles(scaled, tiles, overlap), scale


def count_symbols(client: OpenAI, sheet: Image.Image, symbols: list[str], *, usage: Usage, effort: str = "medium",
                  tiles: int = 1, max_side: int = 4096) -> dict[str, list[tuple[float, float]]]:
    """Spark point-and-count per symbol, legend samples excluded; points are in full-sheet pixels."""
    _, parts, scale = count_tiles(sheet, tiles, max_side)
    points = count_points(client, parts, symbols, usage=usage, effort=effort, extra=LEGEND_RULE)
    return {name: [(x / scale, y / scale) for x, y in pts] for name, pts in points.items()}
