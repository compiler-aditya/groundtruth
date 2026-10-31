"""Offline checks for the three fixes: module grid count, scaled drawing tiles, tag dropped from compare."""
import json
import sys
from pathlib import Path
from types import SimpleNamespace as NS

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from PIL import Image  # noqa: E402

from gt import spark  # noqa: E402

# 1. count_modules_per_table: one call per box, crop padded and clamped, usage tallied across threads.
calls = []
def create(**kw):
    calls.append(kw)
    return NS(status="completed", output_text=json.dumps({"module_rows": 4, "module_columns": 3, "modules_fully_visible": 12,
              "modules_cut_by_crop_edge": 0}), usage=NS(input_tokens=100, output_tokens=10), incomplete_details=None)
usage = spark.Usage()
crops = [Image.new("RGB", (40 + i, 30)) for i in range(22)]
grids = spark.count_modules_per_table(NS(responses=NS(create=create)), crops, usage=usage)
assert len(grids) == len(crops) == len(calls) == usage.calls and usage.input_tokens == 100 * len(crops)
print("module grid count ok:", usage)

# 1b. masked_crop greys out what lies outside a diagonal mask but keeps the table itself.
from gt.sam import Detection, masked_crop  # noqa: E402
img = Image.new("RGB", (200, 200), (0, 0, 255))
raster = bytes(1 if abs(x - y) < 10 else 0 for y in range(100) for x in range(100))  # diagonal band
det = Detection("1", (50, 50, 150, 150), 0.9, sum(raster), (100, 100, raster), (50, 50, 150, 150))
crop = masked_crop(img, det, grow=3)
assert crop.size == (106, 106)
assert crop.getpixel((53, 53)) == (0, 0, 255)          # on the diagonal: kept
assert crop.getpixel((90, 20)) == (128, 128, 128)      # off the diagonal, inside the box: greyed
assert masked_crop(img, Detection("2", (0, 0, 20, 20)), grow=0).size == (20, 20)  # no mask: plain box
print("masked crop ok")

# 2. Drawing: a 7177 px sheet is scaled so the whole-sheet tile is <= 4096 px; 2x2 tiles of it need no scaling.
from gt.drawing import count_tiles  # noqa: E402
sheet = Image.new("RGB", (7177, 4896), "white")
scaled, tiles, scale = count_tiles(sheet, 1, 4096)
assert scaled.size == (4096, 2794) and len(tiles) == 1 and abs(scale - 4096 / 7177) < 1e-9, (scaled.size, scale)
scaled, tiles, scale = count_tiles(sheet, 2, 4096)
assert scale == 1.0 and scaled is sheet and len(tiles) == 4 and max(max(t.image.size) for t in tiles) <= 4096
print("drawing tile scaling ok")

# 3. Nameplate compare no longer sends the tag column.
from gt import nameplate  # noqa: E402
sent = []
fake = NS(responses=NS(create=lambda **kw: sent.append(kw) or NS(status="completed", output_text=json.dumps(
    {"fields": [], "overall": "pass", "summary": ""}), usage=None, incomplete_details=None)))
nameplate.check_against_schedule(fake, {"manufacturer": "ABB"}, {"tag": "M-301", "manufacturer": "ABB"}, usage=spark.Usage())
text = sent[0]["input"][0]["content"][0]["text"]
assert "M-301" not in text and '"manufacturer": "ABB"' in text
print("tag dropped from compare ok")
