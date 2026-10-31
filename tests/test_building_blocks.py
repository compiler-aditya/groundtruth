"""Offline checks of the Day 1 helpers with fake API clients (no network)."""
import asyncio
import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace as NS

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from PIL import Image  # noqa: E402

from gt import media, sam, spark  # noqa: E402

# 1. Tiling covers the image and dedupe merges a box split across a tile seam.
img = Image.new("RGB", (1000, 600))
tiles = media.make_tiles(img, 2, 0.1)
assert len(tiles) == 4 and tiles[3].x0 == 450 and tiles[3].y0 == 270, [(t.x0, t.y0, t.image.size) for t in tiles]
dets = [{"box": (480, 100, 540, 160)}, {"box": (480, 100, 520, 160)}, {"box": (700, 400, 760, 460)}]
assert len(media.dedupe_boxes(dets)) == 2
assert media.norm_to_px(1001, 500) == 500 and media.norm_to_px(500, 500) == 250
print("tiling/dedupe ok")

# 2. Spark count: tile-relative 0-1000 points map to full-image pixels and seam duplicates merge.
class FakeResponses:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return NS(status="completed", output_text=json.dumps(self.replies.pop(0)),
                  usage=NS(input_tokens=1000, output_tokens=100), incomplete_details=None)

two = media.make_tiles(Image.new("RGB", (1000, 500)), 1, 0) + [media.Tile(500, 0, Image.new("RGB", (500, 500)))]
fake = NS(responses=FakeResponses([
    {"results": [{"object_name": "Light Fixture", "points": [{"x": 600, "y": 500}, {"x": 100, "y": 100}], "count": 2}]},
    {"results": [{"object_name": "light fixture", "points": [{"x": 202, "y": 500}], "count": 1}]},
]))
usage = spark.Usage()
pts = spark.count_points(fake, two, ["light fixture"], usage=usage, dedupe_radius=10, extra="Only the plan.")
assert pts["light fixture"] == [(600.0, 250.0), (100.0, 50.0)], pts
call = fake.responses.calls[0]
assert call["text"]["format"]["type"] == "json_schema" and call["reasoning"] == {"effort": "low"}
assert "Only the plan." in call["input"][0]["content"][0]["text"]
assert usage.calls == 2 and abs(usage.cost - (2000 * 1.25 + 200 * 4.25) / 1e6) < 1e-12
print("spark count + usage ok:", usage)

# 3. SAM zero-match stream (completed with no output text) returns [] instead of raising.
class FakeAsyncStream:
    def __init__(self, events):
        self.events = events

    def __aiter__(self):
        self._it = iter(self.events)
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration

    async def close(self):
        pass

class FakeAsyncResponses:
    async def create(self, **kwargs):
        assert kwargs["model"] == "sam-3.1" and kwargs["metadata"]["mask_encoding"] == "one_bit"
        return FakeAsyncStream([{"type": "response.created"}, {"type": "response.completed", "response": {}}])

result = asyncio.run(sam.segment_image(NS(responses=FakeAsyncResponses()), Image.new("RGB", (64, 64)), "pile"))
assert result == [], result
print("sam zero-match ok")

# 4. Overlay draws a box-local mask without errors.
det = sam.Detection("1", (10, 10, 30, 20), 0.9, 50, (20, 10, bytes([1] * 200)), (10, 10, 30, 20))
out = sam.draw_detections(Image.new("RGB", (64, 64)), [det])
assert out.getpixel((20, 15)) != (0, 0, 0)
print("overlay ok")

# 5. Walkthrough: fenced JSON is extracted, an invalid first reply triggers one corrective retry.
spec = importlib.util.spec_from_file_location("walk", ROOT / "day1" / "04_walkthrough_spark_open.py")
walk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(walk)
from gt import walkthrough as walk_mod  # noqa: E402
assert walk_mod.extract_json('```json\n{"a": 1}\n```') == {"a": 1}
good = {"summary": "Row 4 incomplete.", "spoken_notes": [{"t_s": 1, "text": "row four is complete"}], "claim_checks": [{"t_s": 1, "claim": "row four complete", "verdict": "contradicted", "visual_evidence": "9 missing"}],
        "observations": [{"t_s": 3, "area": "row 4", "kind": "deviation", "description": "9 modules missing",
                          "evidence": "seen", "severity": "high"}],
        "equipment_tags": [], "max_people_visible": 0,
        "audio_visual_conflicts": [{"t_s": 2, "said": "row four complete", "seen": "9 modules missing"}]}

class FakeChat:
    def __init__(self):
        self.replies = ["Sure! Here is the report: {not json", "```json\n" + json.dumps(good) + "\n```"]
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        details = NS(reasoning_tokens=300)
        return NS(choices=[NS(message=NS(content=self.replies.pop(0)), finish_reason="stop")],
                  usage=NS(prompt_tokens=7000, completion_tokens=900, completion_tokens_details=details))

chat = FakeChat()
report, stats = walk_mod.ask_clip(NS(chat=NS(completions=chat)), [{"type": "text", "text": "x"}], "low", 4000)
assert stats["attempts"] == 2 and stats["reasoning_tokens"] == 600 and report.audio_visual_conflicts
assert chat.calls[0]["reasoning_effort"] == "low" and chat.calls[0]["model"] == walk_mod.SPARK_OPEN
assert chat.calls[1]["messages"][-1]["role"] == "user" and "corrected JSON" in chat.calls[1]["messages"][-1]["content"]
print("walkthrough parse + retry ok")
print("ALL OFFLINE CHECKS PASSED")
