"""Reading a user's draft (a hand sketch, a photo of a drawing, an old floor plan) into rooms, doors and windows with
Muse Spark 1.3, so the design assistant can lay it out as an editable plan.

The model reads positions as fractions of the plan's outline and any dimensions written on the draft; the code turns
them into metres. Muse Wonder then places the rooms with the plan tools, which snap and check them.
"""

from __future__ import annotations

import io
import math

import pymupdf
from openai import OpenAI
from PIL import Image, ImageOps

from .floorplan import ROOM_TYPES
from .media import fit_long_side
from .spark import Usage, image_part, structured, text_part

NUM_OR_NULL = {"type": ["number", "null"]}
SIDE = {"type": "string", "enum": ["north", "south", "east", "west"]}
SKETCH_SCHEMA = {
    "type": "object",
    "properties": {
        "what_it_is": {"type": "string", "description": "one line, e.g. 'hand sketch of a two-bedroom house'"},
        "is_floor_plan": {"type": "boolean"},
        "outline_aspect": {"type": "number", "description": "width / height of the whole plan outline as drawn"},
        "overall_width_m": NUM_OR_NULL,
        "overall_depth_m": NUM_OR_NULL,
        "rooms": {"type": "array", "items": {"type": "object", "properties": {
            "name": {"type": "string"}, "type": {"type": "string", "enum": list(ROOM_TYPES)},
            "left": {"type": "number"}, "top": {"type": "number"}, "right": {"type": "number"}, "bottom": {"type": "number"},
            "width_m": NUM_OR_NULL, "depth_m": NUM_OR_NULL},
            "required": ["name", "type", "left", "top", "right", "bottom", "width_m", "depth_m"], "additionalProperties": False}},
        "doors": {"type": "array", "items": {"type": "object", "properties": {"between": {"type": "string"}, "and": {"type": "string"}},
                                             "required": ["between", "and"], "additionalProperties": False}},
        "windows": {"type": "array", "items": {"type": "object", "properties": {"room": {"type": "string"}, "wall": SIDE},
                                               "required": ["room", "wall"], "additionalProperties": False}},
        "notes": {"type": "string"},
    },
    "required": ["what_it_is", "is_floor_plan", "outline_aspect", "overall_width_m", "overall_depth_m", "rooms", "doors", "windows", "notes"],
    "additionalProperties": False,
}
PROMPT = (
    "This is someone's draft of a building: a hand sketch, a photo of a drawing, or an old floor plan. Read it as a "
    "floor plan seen from above, with north at the top of the image.\n"
    "- For every room: its name (as written, or a sensible one), its type, and its rectangle as fractions 0-1 of the "
    "whole plan outline (left, top, right, bottom; 0,0 is the outline's top-left corner). Approximate L-shapes by "
    "their main rectangle.\n"
    "- Read any dimensions written on it. width_m/depth_m per room only where written or clearly implied; the "
    "overall size in metres if written or inferable (feet: convert), else null.\n"
    "- outline_aspect: the outline's width divided by its height as drawn.\n"
    "- Doors: which two rooms each connects ('outside' for an entrance). Windows: room and wall.\n"
    "- notes: anything else the drawer asks for (written requests, furniture, labels you could not read).\n"
    "If it is not a floor plan, set is_floor_plan false, describe it in what_it_is, and leave rooms empty."
)


def load_draft(data: bytes, filename: str) -> Image.Image:
    """An uploaded image or the first page of a PDF, upright and at most 2000 px on its long side."""
    if filename.lower().endswith(".pdf"):
        doc = pymupdf.open(stream=data, filetype="pdf")
        pix = doc[0].get_pixmap(dpi=150)
        image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    else:
        image = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    return fit_long_side(image, 2000)


def read_draft(client: OpenAI, image: Image.Image, *, usage: Usage, effort: str = "medium") -> dict:
    return structured(client, [image_part(image), text_part(PROMPT)], "floor_plan_draft", SKETCH_SCHEMA, usage=usage, effort=effort)


def to_metres(reading: dict) -> dict:
    """Overall size in metres (written, inferred from room dimensions, or estimated from the room count) and each
    room's rectangle in metres."""
    rooms = [r for r in reading.get("rooms", []) if r["right"] > r["left"] and r["bottom"] > r["top"]]
    aspect = reading.get("outline_aspect") or 1.3
    aspect = min(max(aspect, 0.25), 4.0)
    width, depth, source = reading.get("overall_width_m"), reading.get("overall_depth_m"), "written on the draft"
    if not width:
        scales = [r["width_m"] / (r["right"] - r["left"]) for r in rooms if r.get("width_m")]
        scales += [r["depth_m"] / (r["bottom"] - r["top"]) * aspect for r in rooms if r.get("depth_m")]
        if scales:
            width, source = sum(scales) / len(scales), "from the room dimensions on the draft"
        elif depth:
            width = depth * aspect
        else:
            width, source = math.sqrt(15 * max(len(rooms), 1) * aspect), "estimated at about 15 m² a room (no dimensions on the draft)"
    depth = depth or width / aspect
    placed = [{"name": r["name"], "type": r["type"], "x": r["left"] * width, "y": r["top"] * depth,
               "w": (r["right"] - r["left"]) * width, "h": (r["bottom"] - r["top"]) * depth} for r in rooms]
    return {"width": width, "depth": depth, "source": source, "rooms": placed}


def describe_draft(reading: dict) -> str:
    """The reading as a brief for the design assistant."""
    if not reading.get("is_floor_plan") or not reading.get("rooms"):
        return f"The uploaded file was read by Muse Spark 1.3 as: {reading.get('what_it_is')}. It is not a floor plan it could read. {reading.get('notes', '')}"
    m = to_metres(reading)
    lines = [f"The uploaded draft, read by Muse Spark 1.3: {reading['what_it_is']}. Overall about {m['width']:.1f} × {m['depth']:.1f} m ({m['source']}).",
             "Rooms (metres; x east, y south; approximate):"]
    lines += [f"- {r['name']} [{r['type']}]: x {r['x']:.1f}–{r['x'] + r['w']:.1f}, y {r['y']:.1f}–{r['y'] + r['h']:.1f} ({r['w']:.1f} × {r['h']:.1f} m)" for r in m["rooms"]]
    if reading.get("doors"):
        lines.append("Doors: " + "; ".join(f"{d['between']} – {d['and']}" for d in reading["doors"]))
    if reading.get("windows"):
        lines.append("Windows: " + "; ".join(f"{w['room']} ({w['wall']})" for w in reading["windows"]))
    if reading.get("notes"):
        lines.append(f"Notes on the draft: {reading['notes']}")
    lines.append("Lay this out faithfully as a new plan: keep each room's position and size close to the draft, rounded to clean "
                 "dimensions, with rooms sharing walls where they touch on the draft (close small gaps, remove overlaps). Then add the "
                 "doors, an entrance and the windows shown, and anything the brief needs that the draft leaves out.")
    return "\n".join(lines)
