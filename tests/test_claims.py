"""Offline check of gt/claims.py: real frame grabs, fake Spark and SAM."""
import asyncio
import json
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace as NS

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from gt import claims  # noqa: E402
from gt.sam import Detection  # noqa: E402
from gt.spark import Usage  # noqa: E402

src = ROOT / "samples/walk/synthetic_walk.mp4"
tmp = Path(tempfile.mkdtemp())
frames = claims.grab_frames(src, 0.3, 40.0, tmp, "c0")
assert [round(t, 1) for t, _ in frames] == [0.8, 2.8, 4.8], frames
from PIL import Image  # noqa: E402
assert Image.open(frames[0][1]).size == (1280, 720)
end = claims.grab_frames(src, 38.0, 40.0, tmp, "c1")
assert end[-1][0] == 39.9 and len(end) == 2, end  # clamped to the end, duplicates dropped
print("frame grabs ok")

assert claims.count_verdict(24, 24) == "confirmed"
assert claims.count_verdict(24, 23) == "needs_review"
assert claims.count_verdict(24, 15) == "contradicted"
assert claims.count_verdict(200, 190) == "needs_review" and claims.count_verdict(200, 188) == "contradicted"
print("count verdicts ok")

check = {"frame_used": 0, "verdict": "contradicted", "evidence": "row 4 has 15 modules", "is_count_claim": True,
         "count_noun_phrase": "solar panel", "claimed_count": 24, "observed_count": 15,
         "scope_box": {"x_min": 0, "y_min": 400, "x_max": 1000, "y_max": 500}}
spark = NS(responses=NS(create=lambda **kw: NS(status="completed", output_text=json.dumps(check),
                                               usage=NS(input_tokens=5000, output_tokens=500), incomplete_details=None)))
# 1280x720 frame: scope box spans y 288-360. 15 detections centred inside, 10 above it.
fake = [Detection(str(i), (40 * i, 300, 40 * i + 30, 340)) for i in range(15)]
fake += [Detection(f"a{i}", (40 * i, 100, 40 * i + 30, 140)) for i in range(10)]

async def fake_segment_tiles(client, tiles, phrase, concurrency=8):
    assert phrase == "solar panel" and len(tiles) == 4
    return fake

claims.segment_tiles = fake_segment_tiles
result = asyncio.run(claims.verify_claim(spark, None, Usage(), {"t_s": 0.3, "claim": "row 4 complete", "verdict": "not_visible"},
                                         frames, "24 modules", tmp))
assert result["sam_count_in_scope"] == 15 and result["sam_count_in_frame"] == 25, result
assert result["final_verdict"] == "contradicted" and result["method"].startswith("SAM")
assert Path(result["overlay"]).exists()
print("scope filtering + verdict ok")

check2 = dict(check, is_count_claim=False, count_noun_phrase="", claimed_count=-1, observed_count=-1, verdict="contradicted")
spark2 = NS(responses=NS(create=lambda **kw: NS(status="completed", output_text=json.dumps(check2),
                                                usage=NS(input_tokens=5000, output_tokens=500), incomplete_details=None)))
r2 = asyncio.run(claims.verify_claim(spark2, None, Usage(), {"t_s": 20, "claim": "75 hp"}, frames, "", tmp))
assert r2["final_verdict"] == "contradicted" and "sam_count_in_scope" not in r2
print("non-count claim ok")
print("ALL CLAIM CHECKS PASSED")
