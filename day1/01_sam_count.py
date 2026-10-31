"""Day 1 test 1: count installed components in drone stills with SAM 3.1.

For each image and each noun phrase, SAM returns every match as a box and a
pixel mask. The script reports the count, the masked area (and m² if you give
the ground sample distance), saves an overlay, and can ask Muse Spark for an
independent point-and-count so the two can be compared.

On real nadir stills both SAM and Spark count a whole table of modules as one
"solar panel", whatever the wording. --modules adds a second stage: Spark counts
the module grid inside each table SAM found, and the per-table counts are summed.

Go/no-go: SAM's count is within ±5% of a hand count on at least 3 real stills,
and the overlays show no systematic misses (e.g. a whole row skipped).

Examples:
  python day1/01_sam_count.py samples/drone --phrase "solar panel" --expected "solar panel=240"
  python day1/01_sam_count.py site.jpg --phrase "solar panel" --phrase "pile" --tiles 2 --spark-check
  python day1/01_sam_count.py samples/real/drone --phrase "solar panel" --tiles 2 --modules
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import ImageDraw  # noqa: E402

from gt.config import PRICE, meta_async_client, meta_client, out_dir  # noqa: E402
from gt.media import expand_inputs, fit_long_side, load_image, make_tiles, slug  # noqa: E402
from gt.sam import draw_detections, label_detections, masked_crop, segment_tiles  # noqa: E402
from gt.spark import Usage, count_modules_per_table, count_points, grid_label  # noqa: E402


def parse_expected(items: list[str]) -> dict[str, int]:
    expected = {}
    for item in items:
        name, _, value = item.rpartition("=")
        if not name or not value.isdigit():
            raise SystemExit(f'--expected must look like "solar panel=240", got {item!r}')
        expected[name.strip()] = int(value)
    return expected


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("inputs", nargs="+", help="image files, folders of images, or image URLs")
    parser.add_argument("--phrase", action="append", required=True, help="one short noun phrase per object type (repeatable)")
    parser.add_argument("--expected", action="append", default=[], help='design quantity, e.g. "solar panel=240" (repeatable)')
    parser.add_argument("--tiles", type=int, default=1, help="split each image into an N x N grid first (helps small objects)")
    parser.add_argument("--overlap", type=float, default=0.12, help="tile overlap as a fraction of tile size")
    parser.add_argument("--max-side", type=int, default=4096, help="downscale so the long side is at most this many pixels")
    parser.add_argument("--gsd", type=float, help="ground sample distance of the original image, in metres per pixel")
    parser.add_argument("--spark-check", action="store_true", help="also count with Muse Spark point-and-count for comparison")
    parser.add_argument("--spark-tiles", type=int, default=1,
                        help="N x N tiles for the Spark count; 1 is best (on the synthetic still: 179/180 whole vs 185-238 tiled)")
    parser.add_argument("--modules", action="store_true",
                        help="treat each SAM match as a table and have Spark count the modules in it (one call per table)")
    parser.add_argument("--dry-run", action="store_true", help="load and tile images, print the plan and cost, call nothing")
    args = parser.parse_args()

    sources = expand_inputs(args.inputs)
    expected = parse_expected(args.expected)
    out = out_dir("sam")
    sam_requests = len(sources) * len(args.phrase) * max(1, args.tiles) ** 2
    print(f"{len(sources)} image(s) x {len(args.phrase)} phrase(s) x {max(1, args.tiles) ** 2} tile(s) "
          f"= {sam_requests} SAM requests, ~${sam_requests * PRICE['sam_per_image']:.3f}")

    if args.modules:
        print("--modules: plus one Spark call per table SAM finds (~$0.009 each at low effort)")
    sam_client = None if args.dry_run else meta_async_client()
    spark_client = meta_client() if (args.spark_check or args.modules) and not args.dry_run else None
    usage = Usage()
    report = []

    for source in sources:
        original = load_image(source)
        image = fit_long_side(original, args.max_side)
        scale = image.width / original.width
        tiles = make_tiles(image, args.tiles, args.overlap)
        name = Path(source.split("?")[0]).stem
        print(f"\n== {name}  {original.width}x{original.height}"
              + (f" -> sent at {image.width}x{image.height}" if scale < 1 else "")
              + (f", {len(tiles)} tiles of ~{tiles[0].image.width}x{tiles[0].image.height}" if len(tiles) > 1 else ""))
        if args.dry_run:
            continue

        # SAM needs tiles for small, dense objects (synthetic still: 180/180 tiled vs 134 whole), while
        # Spark counts best whole: its points on repeated objects are too loose to merge across tile seams.
        spark_tiles = make_tiles(image, args.spark_tiles, args.overlap)
        spark_points = count_points(spark_client, spark_tiles, args.phrase, usage=usage) if args.spark_check and spark_client else {}

        for phrase in args.phrase:
            detections = await segment_tiles(sam_client, tiles, phrase)
            confidences = [d.confidence for d in detections if d.confidence is not None]
            area_px = sum(d.mask_area_px for d in detections)
            row = {
                "image": source,
                "phrase": phrase,
                "sam_count": len(detections),
                "mean_confidence": round(statistics.mean(confidences), 3) if confidences else None,
                "low_confidence_count": sum(1 for c in confidences if c < 0.5),
                "mask_area_px": area_px,
                "detections": [d.as_dict() for d in detections],
            }
            if args.gsd:
                # Pixels were counted on the downscaled image, so each covers (gsd / scale) metres.
                row["mask_area_m2"] = round(area_px * (args.gsd / scale) ** 2, 1)
            if phrase in expected:
                row["expected"] = expected[phrase]
                row["progress_pct"] = round(100 * len(detections) / expected[phrase], 1)
            if phrase in spark_points:
                row["spark_count"] = len(spark_points[phrase])
                larger = max(row["spark_count"], row["sam_count"], 1)
                row["sam_spark_agreement_pct"] = round(100 * min(row["spark_count"], row["sam_count"]) / larger, 1)

            grids = []
            if args.modules and detections:
                crops = [masked_crop(image, d) for d in detections]
                grids = await asyncio.to_thread(count_modules_per_table, spark_client, crops, usage=usage)
                full = sum(g["modules_fully_visible"] for g in grids)
                cut = sum(g["modules_cut_by_crop_edge"] for g in grids)
                row["modules"] = {"fully_visible": full, "cut_by_edge": cut, "total": full + cut,
                                  "per_table": [{"box": list(d.box), **g} for d, g in zip(detections, grids)]}

            overlay = draw_detections(image, detections)
            draw = ImageDraw.Draw(overlay)
            if phrase in spark_points:
                for x, y in spark_points[phrase]:
                    draw.ellipse((x - 5, y - 5, x + 5, y + 5), fill=(0, 200, 255), outline=(0, 0, 0))
            if grids:
                label_detections(overlay, detections, [grid_label(g) for g in grids])
            overlay_path = out / f"{slug(name)}__{slug(phrase)}.jpg"
            overlay.save(overlay_path, quality=88)
            row["overlay"] = str(overlay_path)
            report.append(row)

            line = f"  {phrase!r}: SAM {row['sam_count']}"
            if row["mean_confidence"] is not None:
                line += f" (mean conf {row['mean_confidence']}, {row['low_confidence_count']} below 0.5)"
            if "spark_count" in row:
                line += f" | Spark {row['spark_count']} | agreement {row['sam_spark_agreement_pct']}%"
            if "progress_pct" in row:
                line += f" | design {row['expected']} -> {row['progress_pct']}% installed"
            if "modules" in row:
                m = row["modules"]
                line += f" | modules in those tables: {m['fully_visible']} fully visible + {m['cut_by_edge']} cut = {m['total']}"
            if "mask_area_m2" in row:
                line += f" | {row['mask_area_m2']} m²"
            print(line)
            print(f"    overlay: {overlay_path}")

    if args.dry_run:
        print("\nDry run: no API calls made.")
        return
    (out / "results.json").write_text(json.dumps(report, indent=2))
    print(f"\nSAM cost ~${sam_requests * PRICE['sam_per_image']:.3f}" + (f"; Spark: {usage}" if usage.calls else ""))
    print(f"Results: {out / 'results.json'}")
    print("Blue dots = Spark points, red boxes/fill = SAM detections.")


if __name__ == "__main__":
    asyncio.run(main())
