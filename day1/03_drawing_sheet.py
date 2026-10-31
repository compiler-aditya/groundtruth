"""Day 1 test 3: read one construction drawing sheet with Muse Spark 1.3.

Three checks on one sheet:
  1. Title block, legend and equipment tags into JSON (schema-constrained).
  2. Symbol counts with Spark point-and-count, with dots drawn on an overlay so
     you can check each one. The whole sheet is counted in one call by default
     (scaled to fit the image limit): on a real 7177 px sheet, 2x2 tiles counted
     symbols near the seams twice (116 vs 104 fixtures) and the whole sheet did not
     (109). Use --tiles N only when symbols are too small to see at --count-max-side.
  3. Optional: the same symbol with SAM 3.1 (--sam-phrase), to decide whether
     SAM is usable on line drawings at all. SAM was trained on photos, so this
     is a genuine go/no-go.

Go/no-go: title block fields 100% right, at least 80% of the tags on the sheet
found, symbol counts within ±10% of a hand count. Record the SAM result either way.

PDFs: only the pages you pick are rendered and sent. The API only reads the first 50
page images of an uploaded PDF, so big sets will always go sheet by sheet like this.

Examples:
  python day1/03_drawing_sheet.py samples/drawing.pdf --count "duplex receptacle" --expected "duplex receptacle=14"
  python day1/03_drawing_sheet.py E-101.png --count "door" --count "light fixture" --tiles 3 --sam-phrase "door"
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pymupdf  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

from gt.config import PRICE, meta_async_client, meta_client, out_dir  # noqa: E402
from gt.media import fit_long_side, load_image, make_tiles, slug  # noqa: E402
from gt.sam import draw_detections, segment_tiles  # noqa: E402
from gt.spark import Usage, count_points, image_part, structured, text_part  # noqa: E402

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
            raise SystemExit(f"{path} has {doc.page_count} page(s); --page {page} is out of range.")
        pix = doc[page - 1].get_pixmap(dpi=dpi)
        return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    return load_image(path)


def parse_expected(items: list[str]) -> dict[str, int]:
    pairs = [item.rpartition("=") for item in items]
    return {name.strip(): int(value) for name, _, value in pairs if name and value.isdigit()}


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("sheet", help="a PDF (one page is used) or an image of one sheet")
    parser.add_argument("--page", type=int, default=1, help="1-based PDF page")
    parser.add_argument("--dpi", type=int, default=150, help="PDF render resolution")
    parser.add_argument("--count", action="append", default=[], help="symbol to count, described in words (repeatable)")
    parser.add_argument("--expected", action="append", default=[], help='hand count, e.g. "duplex receptacle=14"')
    parser.add_argument("--tiles", type=int, default=1, help="N x N tiles for counting (1 = whole sheet)")
    parser.add_argument("--count-max-side", type=int, default=4096,
                        help="scale the sheet so each count tile is at most this many pixels (the API rejects ~7000 px)")
    parser.add_argument("--sam-phrase", action="append", default=[], help="also try SAM with this noun phrase")
    parser.add_argument("--effort", default="medium", choices=["minimal", "low", "medium", "high", "xhigh", "max"])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    out = out_dir("drawing")
    sheet = render_sheet(args.sheet, args.page, args.dpi)
    stem = slug(Path(args.sheet).stem) + (f"-p{args.page}" if args.sheet.lower().endswith(".pdf") else "")
    sheet_path = out / f"{stem}.png"
    sheet.save(sheet_path)
    overview = fit_long_side(sheet, 3072)
    strip = fit_long_side(sheet.crop((int(sheet.width * 0.75), 0, sheet.width, sheet.height)), 2048)
    # Counting runs on a copy scaled so each tile fits the image decode limit; points are mapped back to the sheet.
    overlap = 0.08 if args.tiles > 1 else 0.0
    tile_side = max(sheet.size) / args.tiles * (1 + overlap)
    scale = min(1.0, args.count_max_side / tile_side)
    count_sheet = sheet.resize((round(sheet.width * scale), round(sheet.height * scale)), Image.LANCZOS) if scale < 1 else sheet
    tiles = make_tiles(count_sheet, args.tiles, overlap)
    expected = parse_expected(args.expected)
    print(f"Sheet {sheet.width}x{sheet.height} saved to {sheet_path}; {len(tiles)} count tile(s)"
          + (f" of a copy scaled to {count_sheet.width}x{count_sheet.height}" if scale < 1 else ""))
    print(f"Planned calls: 1 sheet read + {len(tiles) if args.count else 0} count + "
          f"{len(tiles) * len(args.sam_phrase)} SAM (~${len(tiles) * len(args.sam_phrase) * PRICE['sam_per_image']:.3f})")
    if args.dry_run:
        print("Dry run: no API calls made.")
        return

    client = meta_client()
    usage = Usage()
    report: dict = {"sheet": args.sheet, "page": args.page, "image": str(sheet_path)}

    info = structured(
        client, [text_part(SHEET_PROMPT), image_part(overview), image_part(strip)], "sheet", SHEET_SCHEMA,
        usage=usage, effort=args.effort,
    )
    report["sheet_info"] = info
    tb = info["title_block"]
    print(f"\nTitle block: {tb['sheet_number']} - {tb['sheet_title']} | drawing {tb['drawing_number'] or '-'} | "
          f"{tb['discipline']} | rev {tb['revision']} | scale {tb['scale']} | {tb['project_name']}")
    print(f"Legend entries: {len(info['legend'])}; tags: {len(info['equipment_tags'])}; readability: {info['readability']}")
    for tag in info["equipment_tags"][:25]:
        print(f"  {tag['tag']}: {tag['description']} ({tag['location_hint']})")
    if info["issues"]:
        print(f"Issues: {info['issues']}")

    if args.count:
        points = count_points(client, tiles, args.count, usage=usage, effort=args.effort, extra=LEGEND_RULE)
        report["spark_counts"] = {}
        for name, scaled_pts in points.items():
            pts = [(x / scale, y / scale) for x, y in scaled_pts]
            overlay = sheet.copy()
            draw = ImageDraw.Draw(overlay)
            r = max(6, sheet.width // 500)
            for x, y in pts:
                draw.ellipse((x - r, y - r, x + r, y + r), outline=(220, 0, 0), width=3)
            path = out / f"{stem}__count-{slug(name)}.png"
            overlay.save(path)
            entry = {"count": len(pts), "points": [[round(x), round(y)] for x, y in pts], "overlay": str(path)}
            if name in expected:
                entry["expected"] = expected[name]
                entry["error_pct"] = round(100 * (len(pts) - expected[name]) / max(1, expected[name]), 1)
            report["spark_counts"][name] = entry
            print(f"\nSpark count {name!r}: {len(pts)}" + (f" (hand count {expected[name]}, error {entry['error_pct']}%)" if name in expected else ""))
            print(f"  overlay: {path}")

    if args.sam_phrase:
        sam = meta_async_client()
        report["sam"] = {}
        for phrase in args.sam_phrase:
            detections = await segment_tiles(sam, tiles, phrase)
            path = out / f"{stem}__sam-{slug(phrase)}.png"
            draw_detections(count_sheet, detections).save(path)
            report["sam"][phrase] = {"count": len(detections), "overlay": str(path), "pixel_scale": scale,
                                     "detections": [d.as_dict() for d in detections]}
            print(f"\nSAM {phrase!r}: {len(detections)} match(es)" + (f" (hand count {expected[phrase]})" if phrase in expected else ""))
            print(f"  overlay: {path}")

    (out / f"{stem}.json").write_text(json.dumps(report, indent=2))
    print(f"\nSpark: {usage}\nResults: {out / (stem + '.json')}")


if __name__ == "__main__":
    asyncio.run(main())
