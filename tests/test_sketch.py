"""Offline checks of draft reading (the model's reading is faked) and the studio chat endpoint."""
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from PIL import Image  # noqa: E402

from gt.sketch import describe_draft, load_draft, to_metres  # noqa: E402

READING = {
    "what_it_is": "hand sketch of a small house", "is_floor_plan": True, "outline_aspect": 1.5, "overall_width_m": None, "overall_depth_m": None,
    "rooms": [{"name": "Living", "type": "living", "left": 0, "top": 0, "right": 0.6, "bottom": 0.5, "width_m": 6.0, "depth_m": None},
              {"name": "Bed", "type": "bedroom", "left": 0, "top": 0.5, "right": 0.5, "bottom": 1, "width_m": None, "depth_m": None},
              {"name": "Bad", "type": "other", "left": 0.5, "top": 0.5, "right": 0.4, "bottom": 1, "width_m": None, "depth_m": None}],
    "doors": [{"between": "Living", "and": "outside"}], "windows": [{"room": "Bed", "wall": "south"}], "notes": "big kitchen please"}

m = to_metres(READING)
assert abs(m["width"] - 10.0) < 1e-6 and abs(m["depth"] - 10.0 / 1.5) < 1e-6, m  # 6 m over 60% of the width
assert "from the room dimensions" in m["source"] and [r["name"] for r in m["rooms"]] == ["Living", "Bed"], m  # the inverted rectangle is dropped
brief = describe_draft(READING)
assert "Living [living]: x 0.0–6.0, y 0.0–3.3" in brief and "Doors: Living – outside" in brief and "big kitchen please" in brief, brief
no_dims = to_metres({**READING, "rooms": [{**r, "width_m": None} for r in READING["rooms"]]})
assert "estimated" in no_dims["source"] and 5 < no_dims["width"] < 7, no_dims
assert "not a floor plan" in describe_draft({"what_it_is": "a cat", "is_floor_plan": False, "rooms": [], "notes": ""})

# drafts arrive as photos (any orientation, any size) or PDFs
buf = io.BytesIO()
Image.new("RGB", (4000, 3000), "white").save(buf, "JPEG")
assert max(load_draft(buf.getvalue(), "sketch.jpg").size) == 2000

# the studio chat endpoint: a draft is read first, then laid out as a new plan; history reaches the planner
from fastapi.testclient import TestClient  # noqa: E402

import app  # noqa: E402

seen = {}
app.meta_client = lambda: None
app.read_draft = lambda client, image, usage: READING


def fake_planner(text, plan, on_event, history=None):
    seen.update(text=text, plan=plan, history=history)
    on_event({"type": "tool", "tool": "add_room", "ok": True, "brief": "Added Living", "plan": {"rooms": [], "openings": [], "items": []}})
    return {"plan": {"rooms": [], "openings": [], "items": []}, "finished": True, "summary": "done", "cost_usd": 0.2}


app.run_planner = fake_planner
web = TestClient(app.app)
existing = {"rooms": [{"id": "r1", "name": "Hall", "type": "hallway", "x": 0, "y": 0, "w": 4, "h": 1.2}], "openings": [], "items": []}
res = web.post("/api/studio/chat", data={"message": "make this", "plan": json.dumps(existing), "history": json.dumps([{"role": "user", "text": "hi"}])},
               files={"file": ("sketch.jpg", buf.getvalue(), "image/jpeg")})
events = [json.loads(line) for line in res.text.splitlines()]
assert [e["type"] for e in events] == ["start", "note", "sketch", "tool", "done"], [e["type"] for e in events]
assert events[0]["mode"] == "new" and seen["plan"] is None and "make this" in seen["text"] and "read by Muse Spark 1.3" in seen["text"]
assert seen["history"] == [{"role": "user", "text": "hi"}] and events[-1]["cost_usd"] == 0.2
# a message alone changes the current plan
web.post("/api/studio/chat", data={"message": "add a study", "plan": json.dumps(existing)})
assert seen["plan"]["rooms"][0]["id"] == "r1" and seen["text"] == "add a study"
assert web.post("/api/studio/chat", data={"message": ""}).status_code == 400
assert web.post("/api/studio/chat", data={"message": "x"}, files={"file": ("a.exe", b"MZ", "application/octet-stream")}).status_code == 400
assert app._active == 0
print("sketch and studio chat: all checks passed")
