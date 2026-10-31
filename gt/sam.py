"""SAM 3.1 image segmentation over the Responses API, parsed with Meta's meta_sam_parser."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from meta_sam_parser import (
    ResponsesStreamLaneError,
    decode_mask_to_raster,
    image_segmentation_format,
    parse_responses_stream,
)
from openai import AsyncOpenAI
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from .config import SAM
from .media import Tile, dedupe_boxes, to_data_url


@dataclass
class Detection:
    object_id: str
    box: tuple[float, float, float, float]  # left, top, right, bottom in source pixels
    confidence: float | None = None
    mask_area_px: int = 0
    # Box-local mask raster for overlays: (width, height, bytes of 0/1), placed at mask_origin.
    mask: tuple[int, int, bytes] | None = None
    mask_bounds: tuple[float, float, float, float] | None = None
    extra: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "object_id": self.object_id,
            "box": [round(v, 1) for v in self.box],
            "confidence": self.confidence,
            "mask_area_px": self.mask_area_px,
        }


async def segment_image(client: AsyncOpenAI, image: Image.Image, phrase: str) -> list[Detection]:
    """One concept per request: SAM returns every instance of `phrase` with a box and mask."""
    stream = await client.responses.create(
        model=SAM,
        input=[
            {
                "type": "message",
                "role": "user",
                "content": [
                    {"type": "input_text", "text": phrase},
                    {"type": "input_image", "image_url": to_data_url(image)},
                ],
            }
        ],
        stream=True,
        metadata={"mask_encoding": "one_bit", "include_confidence": "true"},
    )
    try:
        result = await parse_responses_stream(stream, image_segmentation_format()).final_result()
    except ResponsesStreamLaneError as error:
        # Zero matches completes with no output text at all, which the parser
        # reports as a lane that never finalized. The docs call this a normal result.
        if "completed before finalizing" in str(error):
            return []
        raise

    detections: dict[str, Detection] = {}
    for record in result.records:
        if record.kind == "box":
            detections.setdefault(record.object_id, Detection(record.object_id, (0, 0, 0, 0)))
            det = detections[record.object_id]
            det.box = (record.left, record.top, record.right, record.bottom)
            det.confidence = record.confidence
        elif record.kind == "mask":
            raster = decode_mask_to_raster(record.mask)
            det = detections.setdefault(record.object_id, Detection(record.object_id, (0, 0, 0, 0)))
            det.mask_area_px = sum(raster)
            det.mask = (record.mask.width, record.mask.height, raster)
            b = record.bounds
            det.mask_bounds = (b.left, b.top, b.right, b.bottom)
    return list(detections.values())


async def segment_tiles(
    client: AsyncOpenAI, tiles: list[Tile], phrase: str, concurrency: int = 8
) -> list[Detection]:
    """Segment each tile, shift results into full-image pixels, and drop overlap duplicates."""
    gate = asyncio.Semaphore(concurrency)

    async def run(tile: Tile) -> list[Detection]:
        async with gate:
            found = await segment_image(client, tile.image, phrase)
        for det in found:
            l, t, r, b = det.box
            det.box = (l + tile.x0, t + tile.y0, r + tile.x0, b + tile.y0)
            if det.mask_bounds:
                l, t, r, b = det.mask_bounds
                det.mask_bounds = (l + tile.x0, t + tile.y0, r + tile.x0, b + tile.y0)
        return found

    batches = await asyncio.gather(*(run(tile) for tile in tiles))
    merged = [det for batch in batches for det in batch]
    if len(tiles) == 1:
        return merged
    wrapped = [{"box": d.box, "det": d} for d in merged]
    return [w["det"] for w in dedupe_boxes(wrapped)]


def _mask_image(det: Detection) -> tuple[Image.Image, tuple[int, int]] | None:
    """The detection's mask as an L image sized to its bounds, and where its top-left sits in the image."""
    if not (det.mask and det.mask_bounds):
        return None
    width, height, raster = det.mask
    mask = Image.frombytes("L", (width, height), bytes(255 if v else 0 for v in raster))
    l, t, r, b = det.mask_bounds
    size = (max(1, round(r - l)), max(1, round(b - t)))
    if mask.size != size:
        mask = mask.resize(size, Image.NEAREST)
    return mask, (round(l), round(t))


def masked_crop(image: Image.Image, det: Detection, grow: int = 9, fill=(128, 128, 128)) -> Image.Image:
    """The detection's box cut from `image`, greyed out beyond its mask (grown by `grow` px to keep edge frames).

    Boxes are axis-aligned, so a box crop of one table in a diagonal row also holds parts of its neighbours.
    """
    W, H = image.size
    x0, y0 = max(0, round(det.box[0]) - grow), max(0, round(det.box[1]) - grow)
    x1, y1 = min(W, round(det.box[2]) + grow), min(H, round(det.box[3]) + grow)
    crop = image.crop((x0, y0, x1, y1)).convert("RGB")
    placed = _mask_image(det)
    if placed is None:
        return crop
    mask, (l, t) = placed
    region = Image.new("L", crop.size, 0)
    region.paste(mask, (l - x0, t - y0))
    if grow:
        region = region.filter(ImageFilter.MaxFilter(grow | 1))
    return Image.composite(crop, Image.new("RGB", crop.size, fill), region)


def draw_detections(image: Image.Image, detections: list[Detection], color=(255, 64, 32)) -> Image.Image:
    canvas = image.convert("RGBA")
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    for det in detections:
        placed = _mask_image(det)
        if placed:
            mask, origin = placed
            layer.paste(Image.new("RGBA", mask.size, color + (90,)), origin, mask)
    canvas = Image.alpha_composite(canvas, layer)
    draw = ImageDraw.Draw(canvas)
    for det in detections:
        draw.rectangle(det.box, outline=color + (255,), width=2)
    return canvas.convert("RGB")


def label_detections(image: Image.Image, detections: list[Detection], labels: list[str]) -> Image.Image:
    """Writes a label at the centre of each detection's box, e.g. its module count."""
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=max(16, image.width // 60))
    for det, label in zip(detections, labels):
        center = ((det.box[0] + det.box[2]) / 2, (det.box[1] + det.box[3]) / 2)
        draw.text(center, label, fill=(255, 255, 0), font=font, anchor="mm", stroke_width=3, stroke_fill=(0, 0, 0))
    return image
