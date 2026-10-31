"""Muse Spark helpers: schema-constrained output and point-and-count grounding."""

from __future__ import annotations

import json
import math
import re
import threading
from concurrent.futures import ThreadPoolExecutor

from openai import OpenAI
from PIL import Image

from .config import PRICE, SPARK
from .media import Tile, norm_to_px, to_data_url


class Usage:
    """Running token and cost tally across calls (Spark 1.3 prices unless given another model's)."""

    def __init__(self, in_per_m: float = PRICE["spark_in_per_m"], out_per_m: float = PRICE["spark_out_per_m"]) -> None:
        self.input_tokens = 0
        self.output_tokens = 0
        self.calls = 0
        self.in_per_m = in_per_m
        self.out_per_m = out_per_m
        self._lock = threading.Lock()

    def add(self, usage) -> None:
        if usage is None:
            return
        with self._lock:
            self.calls += 1
            self.input_tokens += getattr(usage, "input_tokens", None) or getattr(usage, "prompt_tokens", 0) or 0
            self.output_tokens += getattr(usage, "output_tokens", None) or getattr(usage, "completion_tokens", 0) or 0

    @property
    def cost(self) -> float:
        return (self.input_tokens * self.in_per_m + self.output_tokens * self.out_per_m) / 1_000_000

    def __str__(self) -> str:
        return f"{self.calls} calls, {self.input_tokens:,} in / {self.output_tokens:,} out tokens, ~${self.cost:.4f}"


def structured(
    client: OpenAI,
    content: list[dict],
    name: str,
    schema: dict,
    *,
    usage: Usage,
    effort: str = "low",
    model: str = SPARK,
    max_output_tokens: int = 16000,
    instructions: str | None = None,
) -> dict:
    """Responses API call whose output is decoded against `schema` (text.format), so it always parses."""
    response = client.responses.create(
        model=model,
        input=[{"type": "message", "role": "user", "content": content}],
        text={"format": {"type": "json_schema", "name": name, "schema": schema}},
        reasoning={"effort": effort},
        max_output_tokens=max_output_tokens,
        **({"instructions": instructions} if instructions else {}),
    )
    usage.add(response.usage)
    if response.status != "completed":
        detail = getattr(response, "incomplete_details", None)
        raise RuntimeError(f"{name}: response {response.status} ({detail}); raise max_output_tokens or lower effort")
    return json.loads(response.output_text)


def image_part(image: Image.Image) -> dict:
    return {"type": "input_image", "image_url": to_data_url(image)}


def text_part(text: str) -> dict:
    return {"type": "input_text", "text": text}


COUNT_SCHEMA = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "object_name": {"type": "string"},
                    "points": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"x": {"type": "integer"}, "y": {"type": "integer"}},
                            "required": ["x", "y"],
                            "additionalProperties": False,
                        },
                    },
                    "count": {"type": "integer"},
                },
                "required": ["object_name", "points", "count"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["results"],
    "additionalProperties": False,
}


def count_prompt(objects: list[str], extra: str = "") -> str:
    # Wording follows the "Count" grounding mode in dev.meta.ai/docs/image-understanding.
    names = ", ".join(f'"{o}"' for o in objects)
    return (
        f"Point to every instance of each of the following objects in the image and count them: {names}. "
        "Put each point at the center of its object. "
        + (extra + " " if extra else "")
        + 'For each object, answer in the format {"object_name": "<name>", "points": [{"x": <int>, "y": <int>}, ...], '
        '"count": <int>}. The coordinates should be in the 0-1000 range. Put the array of results under "results". '
        "If you cannot find any instances of an object, omit it from the results."
    )


def count_points(
    client: OpenAI,
    tiles: list[Tile],
    objects: list[str],
    *,
    usage: Usage,
    effort: str = "low",
    dedupe_radius: float | None = None,
    extra: str = "",
) -> dict[str, list[tuple[float, float]]]:
    """Spark point-and-count on each tile; returns full-image pixel points per object name.

    Objects in a tile overlap are pointed at from both tiles, rarely at the same
    pixel. Only points from different tiles are merged, and with no fixed radius
    the radius is half the closest spacing between distinct objects seen inside
    one tile, so it follows object size without swallowing close neighbours.
    """
    found: dict[str, list[tuple[float, float, int]]] = {o: [] for o in objects}
    spacing: dict[str, list[float]] = {o: [] for o in objects}
    for index, tile in enumerate(tiles):
        data = structured(
            client,
            [text_part(count_prompt(objects, extra)), image_part(tile.image)],
            "count",
            COUNT_SCHEMA,
            usage=usage,
            effort=effort,
        )
        w, h = tile.image.size
        for result in data["results"]:
            key = _closest(result["object_name"], objects)
            pts = [(tile.x0 + norm_to_px(p["x"], w), tile.y0 + norm_to_px(p["y"], h)) for p in result["points"]]
            spacing[key] += _nearest_neighbour_distances(pts)
            found[key] += [(x, y, index) for x, y in pts]
    merged: dict[str, list[tuple[float, float]]] = {}
    for key, pts in found.items():
        radius = dedupe_radius
        if radius is None:
            # 10th percentile rather than the minimum, in case Spark double-points one object in a tile.
            radius = 0.5 * sorted(spacing[key])[len(spacing[key]) // 10] if spacing[key] else 12
        kept: list[tuple[float, float, int]] = []
        for x, y, tile_index in pts:
            if all(t == tile_index or math.dist((x, y), (kx, ky)) > radius for kx, ky, t in kept):
                kept.append((x, y, tile_index))
        merged[key] = [(x, y) for x, y, _ in kept]
    return merged


GRID_SCHEMA = {
    "type": "object",
    "properties": {
        "module_rows": {"type": "integer"},
        "module_columns": {"type": "integer"},
        "modules_fully_visible": {"type": "integer"},
        "modules_cut_by_crop_edge": {"type": "integer"},
    },
    "required": ["module_rows", "module_columns", "modules_fully_visible", "modules_cut_by_crop_edge"],
    "additionalProperties": False,
}

GRID_PROMPT = (
    "This crop shows one table of solar PV modules seen from above; anything outside that table is greyed out, so "
    "ignore it. Each module is a rectangle framed by light aluminium lines (a module itself contains many small "
    "cells; do not count cells). Count the modules on the table: module_rows x module_columns, how many modules are "
    "fully visible, and how many are cut off by the crop edge."
)


def count_modules_per_table(
    client: OpenAI,
    crops: list[Image.Image],
    *,
    usage: Usage,
    effort: str = "low",
    workers: int = 8,
) -> list[dict]:
    """Second stage of a two-stage module count: Spark counts the module grid in each table crop.

    On real nadir stills SAM and Spark both treat a whole table as "a solar panel" whatever the wording (Taipei:
    24 tables, 188 modules), so modules are counted inside each table instead. Pass masked crops
    (gt.sam.masked_crop): box crops of diagonal rows hold several tables and count them twice.
    """

    def one(crop: Image.Image) -> dict:
        return structured(client, [text_part(GRID_PROMPT), image_part(crop)], "grid", GRID_SCHEMA, usage=usage, effort=effort)

    with ThreadPoolExecutor(workers) as pool:
        return list(pool.map(one, crops))


def grid_label(grid: dict) -> str:
    """'12' for a table with 12 whole modules, '12+3' when 3 more are cut by the image edge."""
    cut = grid["modules_cut_by_crop_edge"]
    return f"{grid['modules_fully_visible']}" + (f"+{cut}" if cut else "")


def _nearest_neighbour_distances(points: list[tuple[float, float]]) -> list[float]:
    if len(points) < 2:
        return []
    return [
        min(math.dist(p, q) for j, q in enumerate(points) if j != i)
        for i, p in enumerate(points)
    ]


def _closest(name: str, options: list[str]) -> str:
    simple = re.sub(r"\W+", " ", name.lower()).strip()
    for option in options:
        if re.sub(r"\W+", " ", option.lower()).strip() == simple:
            return option
    words = set(simple.split())
    return max(options, key=lambda o: len(words & set(o.lower().split())))
