"""Second pass for walkthrough claims: full-resolution frames checked by Muse Spark 1.3, counts by SAM 3.1.

Spark Open sees a video at roughly 70 tokens per frame, enough to hear a claim
and read a close-up but not to count small objects in a wide shot. So each
narrator claim gets stills pulled from the original video at full resolution:
Spark 1.3 judges the claim on those stills and, for a quantity claim, names
what to count and boxes the region the claim is about; SAM then counts inside
that box.
"""

import subprocess
from pathlib import Path

from openai import AsyncOpenAI, OpenAI
from PIL import Image, ImageDraw

from .media import make_tiles, norm_to_px, slug
from .sam import draw_detections, segment_tiles
from .spark import Usage, image_part, structured, text_part

INT = {"type": "integer"}

VERIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "frame_used": {"type": "integer", "description": "index of the frame that best shows what the claim is about"},
        "verdict": {"type": "string", "enum": ["confirmed", "contradicted", "cannot_verify"]},
        "evidence": {"type": "string"},
        "is_count_claim": {"type": "boolean"},
        "count_noun_phrase": {"type": "string"},
        "claimed_count": INT,
        "observed_count": INT,
        "scope_box": {
            "type": "object",
            "properties": {"x_min": INT, "y_min": INT, "x_max": INT, "y_max": INT},
            "required": ["x_min", "y_min", "x_max", "y_max"],
            "additionalProperties": False,
        },
    },
    "required": ["frame_used", "verdict", "evidence", "is_count_claim", "count_noun_phrase",
                 "claimed_count", "observed_count", "scope_box"],
    "additionalProperties": False,
}


def verify_prompt(claim: str, t_s: float, context: str) -> str:
    return (
        f'While filming a site walkthrough, the inspector said: "{claim}" (at {t_s:.1f} s).\n'
        + (f"What the design says should be there:\n{context}\n" if context else "")
        + "The images after this text are full-resolution stills from the video at and just after that moment. "
        "Judge the claim from the stills alone; the narration is not evidence. verdict: confirmed, contradicted, "
        "or cannot_verify. Judge only what this claim literally asserts: an identity claim ('this is motor M-101') "
        "is confirmed if the tag matches, even if the equipment differs from the design in other ways; mention "
        "such differences in evidence instead. frame_used: the frame that shows the subject best.\n"
        "If the claim is about a quantity (a count, 'all', 'every', 'complete'), set is_count_claim true and give: "
        "claimed_count, the number the claim implies (use the design for 'all' or 'complete'); count_noun_phrase, "
        "a short concrete noun phrase a segmentation model can find, such as 'solar panel' or 'anchor bolt'; "
        "observed_count, your own count inside the scope; and scope_box, the part of frame_used the claim is about "
        "(e.g. just the one row it names) on a 0-1000 grid with (0,0) top-left, drawn tightly around that part only. "
        "For any other claim set is_count_claim false, both counts to -1, count_noun_phrase to an empty string, and "
        "scope_box to the whole frame (0, 0, 1000, 1000)."
    )


def grab_frames(src: Path, t: float, duration: float, dest: Path, stem: str,
                offsets: tuple[float, ...] = (0.5, 2.5, 4.5)) -> list[tuple[float, Path]]:
    """Full-resolution stills from the original video just after the claim is spoken."""
    dest.mkdir(parents=True, exist_ok=True)
    times = sorted({round(min(max(t + o, 0.0), duration - 0.1), 2) for o in offsets})
    frames = []
    for i, ts in enumerate(times):
        path = dest / f"{stem}_f{i}.jpg"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{ts:.3f}", "-i", str(src),
                        "-frames:v", "1", "-q:v", "2", str(path)], check=True)
        frames.append((ts, path))
    return frames


def count_verdict(claimed: int, counted: int) -> str:
    """Exact match confirms; a miss of one (or 5%) is left for review, since SAM can drop an object."""
    if counted == claimed:
        return "confirmed"
    if abs(counted - claimed) <= max(1, round(0.05 * claimed)):
        return "needs_review"
    return "contradicted"


async def verify_claim(
    spark: OpenAI,
    sam: AsyncOpenAI,
    usage: Usage,
    claim: dict,
    frames: list[tuple[float, Path]],
    context: str,
    overlay_dir: Path,
    sam_tiles: int = 2,
) -> dict:
    images = [Image.open(path).convert("RGB") for _, path in frames]
    content = [text_part(verify_prompt(claim["claim"], claim["t_s"], context))]
    for i, ((ts, _), image) in enumerate(zip(frames, images)):
        content += [text_part(f"Frame {i} (t = {ts:.1f} s):"), image_part(image)]
    check = structured(spark, content, "claim_check", VERIFY_SCHEMA, usage=usage, effort="medium")

    result = {
        "t_s": claim["t_s"],
        "claim": claim["claim"],
        "first_pass_verdict": claim.get("verdict"),
        "spark": check,
        "frames": [str(p) for _, p in frames],
        "final_verdict": check["verdict"],
        "method": "Spark 1.3 on full-resolution stills",
    }
    if not (check["is_count_claim"] and check["count_noun_phrase"].strip()):
        return result

    index = min(max(check["frame_used"], 0), len(images) - 1)
    frame = images[index]
    w, h = frame.size
    b = check["scope_box"]
    box = (norm_to_px(b["x_min"], w), norm_to_px(b["y_min"], h), norm_to_px(b["x_max"], w), norm_to_px(b["y_max"], h))
    phrase = check["count_noun_phrase"].strip()
    detections = await segment_tiles(sam, make_tiles(frame, sam_tiles, 0.12), phrase)
    inside = [
        d for d in detections
        if box[0] <= (d.box[0] + d.box[2]) / 2 <= box[2] and box[1] <= (d.box[1] + d.box[3]) / 2 <= box[3]
    ]
    overlay = draw_detections(frame, inside)
    ImageDraw.Draw(overlay).rectangle(box, outline=(255, 210, 0), width=3)
    overlay_path = overlay_dir / f"claim_{claim['t_s']:06.1f}_{slug(phrase)}.jpg"
    overlay.save(overlay_path, quality=88)

    result.update(
        sam_phrase=phrase,
        sam_count_in_scope=len(inside),
        sam_count_in_frame=len(detections),
        sam_requests=sam_tiles**2,
        overlay=str(overlay_path),
    )
    if check["claimed_count"] >= 0:
        result["final_verdict"] = count_verdict(check["claimed_count"], len(inside))
        result["method"] = f"SAM 3.1 count in Spark's scope box (frame {index})"
    return result
