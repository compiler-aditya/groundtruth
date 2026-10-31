"""Day 1 test 4: a narrated site walkthrough through Muse Spark Open on Baseten.

The video is cut into short clips (Baseten's encoder samples at most 96 frames
per clip, so 45 s clips keep about 2 frames per second). Each clip is sent as
its video plus its own audio track in one request, so the model can connect
what the inspector says with what the camera shows, and flag where they differ.

Baseten's Spark Open has no structured output or JSON mode, so the reply is
parsed and validated here, with one corrective retry.

Video reaches the model at about 70 tokens per frame, too coarse to count
small objects in a wide shot. So every narrator claim then gets a second pass
(gt/claims.py): full-resolution stills from that moment, judged by Spark 1.3,
with SAM 3.1 counting inside the region the claim is about. Skip it with --no-verify.

Go/no-go: the spoken notes are captured, a planted say-vs-see conflict is
caught, at least 90% of clips return valid JSON without the retry, and
token use and latency per clip are acceptable at the chosen --effort.

Examples:
  python day1/04_walkthrough_spark_open.py samples/walk.mp4
  python day1/04_walkthrough_spark_open.py walk.mov --context-file samples/area_context.txt --effort low --max-clips 2
"""

import argparse
import asyncio
import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Literal

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pydantic import BaseModel, ValidationError  # noqa: E402

from gt.claims import grab_frames, verify_claim  # noqa: E402
from gt.config import PRICE, SPARK_OPEN, baseten_client, meta_async_client, meta_client, out_dir  # noqa: E402
from gt.media import file_data_url  # noqa: E402
from gt.spark import Usage  # noqa: E402

INLINE_LIMIT_MB = 70  # Baseten asks for URLs above ~74 MB


class SpokenNote(BaseModel):
    t_s: float
    text: str


class Observation(BaseModel):
    t_s: float
    area: str
    kind: Literal["progress", "deviation", "safety", "quality", "other"]
    description: str
    evidence: Literal["seen", "heard", "both"]
    severity: Literal["info", "low", "medium", "high"]


class TagSighting(BaseModel):
    tag: str
    t_s: float
    evidence: Literal["seen", "heard", "both"]


class Conflict(BaseModel):
    t_s: float
    said: str
    seen: str


class ClaimCheck(BaseModel):
    t_s: float
    claim: str
    verdict: Literal["confirmed", "contradicted", "not_visible"]
    visual_evidence: str


class ClipReport(BaseModel):
    summary: str
    spoken_notes: list[SpokenNote]
    claim_checks: list[ClaimCheck]
    observations: list[Observation]
    equipment_tags: list[TagSighting]
    max_people_visible: int
    audio_visual_conflicts: list[Conflict]


SYSTEM = (
    "You review construction site walkthrough footage for a project engineer. You are given one clip as video "
    "plus the same clip's audio track, where the person filming narrates. Report only what is visible or "
    "audible; never invent equipment, tags or defects. Times are seconds from the start of this clip. "
    "Reply with a single JSON object and nothing else."
)


def instructions(context: str) -> str:
    schema = json.dumps(ClipReport.model_json_schema())
    return (
        (f"What the design says should be in this area:\n{context}\n\n" if context else "")
        + "Produce a JSON object matching this JSON Schema:\n" + schema + "\n\n"
        "spoken_notes: what the narrator says, close to verbatim. claim_checks: every factual claim the narrator "
        "makes (counts, 'complete', 'installed', ratings, 'matches the schedule'), each checked against the frames "
        "on screen while it is said: confirmed, contradicted, or not_visible, with what you actually see. Count "
        "and inspect for yourself; do not accept the narration as evidence. observations: installed work, "
        "deviations from the design context, safety and quality issues, each marked seen, heard or both. "
        "equipment_tags: tags read on equipment or spoken aloud. audio_visual_conflicts: every contradicted claim "
        "(e.g. says 'anchored' but bolts are missing). Empty arrays are fine."
    )


def probe(path: Path) -> dict:
    raw = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height",
         "-of", "json", str(path)],
        check=True, capture_output=True, text=True,
    ).stdout
    data = json.loads(raw)
    video = next((s for s in data["streams"] if s["codec_type"] == "video"), None)
    if video is None:
        raise SystemExit(f"{path} has no video stream.")
    return {
        "duration": float(data["format"]["duration"]),
        "width": video["width"],
        "height": video["height"],
        "has_audio": any(s["codec_type"] == "audio" for s in data["streams"]),
    }


def cut_clip(src: Path, start: float, length: float, info: dict, dest: Path) -> tuple[Path, Path | None]:
    short = min(info["width"], info["height"])
    target = min(720, short)
    scale = f"scale=-2:{target}" if info["width"] >= info["height"] else f"scale={target}:-2"
    video = dest.with_suffix(".mp4")
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", str(src),
         "-map", "0:v:0", "-vf", scale, "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
         "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", str(video)],
        check=True,
    )
    audio = None
    if info["has_audio"]:
        audio = dest.with_suffix(".wav")
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", str(src),
             "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(audio)],
            check=True,
        )
    return video, audio


def extract_json(text: str) -> dict:
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("no JSON object in the reply")
    return json.loads(text[start : end + 1])


def ask_clip(client, parts: list[dict], effort: str, max_tokens: int) -> tuple[ClipReport, dict]:
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": parts}]
    stats = {"attempts": 0, "prompt_tokens": 0, "completion_tokens": 0, "reasoning_tokens": 0, "seconds": 0.0}
    for attempt in range(2):
        started = time.time()
        response = client.chat.completions.create(
            model=SPARK_OPEN, messages=messages, reasoning_effort=effort, max_tokens=max_tokens,
        )
        stats["seconds"] += time.time() - started
        stats["attempts"] += 1
        usage = response.usage
        if usage:
            stats["prompt_tokens"] += usage.prompt_tokens or 0
            stats["completion_tokens"] += usage.completion_tokens or 0
            details = getattr(usage, "completion_tokens_details", None)
            stats["reasoning_tokens"] += (getattr(details, "reasoning_tokens", 0) or 0) if details else 0
        choice = response.choices[0]
        reply = choice.message.content or ""
        try:
            return ClipReport.model_validate(extract_json(reply)), stats
        except (ValueError, ValidationError) as error:
            if attempt == 1:
                raise RuntimeError(f"invalid JSON after retry (finish_reason={choice.finish_reason}): {error}") from error
            messages += [
                {"role": "assistant", "content": reply},
                {"role": "user", "content": f"That reply did not match the schema: {str(error)[:800]}. "
                                            "Reply with only the corrected JSON object."},
            ]
    raise AssertionError("unreachable")


def mmss(seconds: float) -> str:
    return f"{int(seconds // 60):02d}:{seconds % 60:04.1f}"


async def verify_claims(src: Path, info: dict, claims: list[dict], context: str, out: Path, sam_tiles: int) -> tuple[list[dict], Usage]:
    spark, sam, usage = meta_client(), meta_async_client(), Usage()
    results = []
    for n, claim in enumerate(claims):
        frames = grab_frames(src, claim["t_s"], info["duration"], out / "frames", f"claim{n:02d}")
        result = await verify_claim(spark, sam, usage, claim, frames, context, out, sam_tiles)
        results.append(result)
        line = f"  {mmss(claim['t_s'])} {result['final_verdict'].upper()}: {claim['claim']!r}"
        if "sam_count_in_scope" in result:
            spark_check = result["spark"]
            line += (f"\n      SAM: {result['sam_count_in_scope']} {result['sam_phrase']!r} in scope "
                     f"(claimed {spark_check['claimed_count']}, Spark counted {spark_check['observed_count']})"
                     f" | overlay {result['overlay']}")
        line += f"\n      {result['spark']['evidence']}"
        if result["first_pass_verdict"] and result["first_pass_verdict"] != result["final_verdict"]:
            line += f"\n      (first pass on video said {result['first_pass_verdict']})"
        print(line)
    return results, usage


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("video", help="walkthrough video with narration (MP4/MOV)")
    parser.add_argument("--clip-seconds", type=float, default=45, help="clip length; Baseten allows up to 300 s")
    parser.add_argument("--max-clips", type=int, default=0, help="stop after this many clips (0 = all)")
    parser.add_argument("--context-file", help="text describing what the design says is in this area")
    parser.add_argument("--effort", default="medium", choices=["low", "medium", "high", "xhigh"],
                        help="Spark Open defaults to xhigh when unset, which is slow; check tokens per clip")
    parser.add_argument("--max-tokens", type=int, default=12000, help="output budget; reasoning tokens count toward it")
    parser.add_argument("--no-verify", action="store_true", help="skip the full-resolution claim check (Meta API)")
    parser.add_argument("--sam-tiles", type=int, default=2, help="N x N tiles for SAM counts in the claim check")
    parser.add_argument("--dry-run", action="store_true", help="cut clips and print the plan without calling Baseten")
    args = parser.parse_args()

    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise SystemExit("ffmpeg and ffprobe are required (brew install ffmpeg).")
    src = Path(args.video)
    info = probe(src)
    context = Path(args.context_file).read_text() if args.context_file else ""
    out = out_dir("walkthrough")
    clips_dir = out / "clips"
    clips_dir.mkdir(exist_ok=True)

    starts = []
    t = 0.0
    while t < info["duration"] - 1:
        starts.append(t)
        t += args.clip_seconds
    if args.max_clips:
        starts = starts[: args.max_clips]
    print(f"{src.name}: {info['duration']:.1f}s {info['width']}x{info['height']}, audio: {info['has_audio']}; "
          f"{len(starts)} clip(s) of {args.clip_seconds:.0f}s; effort {args.effort}")
    if min(info["width"], info["height"]) < 448:
        print("  warning: short side is under 448 px; Spark Open may say it cannot view the video")
    if not info["has_audio"]:
        print("  warning: no audio track; sending video only")

    client = None if args.dry_run else baseten_client()
    timeline: list[dict] = []
    totals = {"prompt_tokens": 0, "completion_tokens": 0, "reasoning_tokens": 0, "seconds": 0.0, "retries": 0}

    for index, start in enumerate(starts):
        length = min(args.clip_seconds, info["duration"] - start)
        video, audio = cut_clip(src, start, length, info, clips_dir / f"clip{index:02d}")
        size_mb = (video.stat().st_size + (audio.stat().st_size if audio else 0)) / 1e6
        est_video_tokens = min(round(length * 144), 6900)  # Baseten: ~144 tokens/s at 720p, capped ~6.9K
        print(f"\n[clip {index}] {mmss(start)}-{mmss(start + length)}  payload {size_mb:.1f} MB, "
              f"~{est_video_tokens:,} video tokens")
        if size_mb > INLINE_LIMIT_MB:
            raise SystemExit("Clip is too large to send inline; lower --clip-seconds.")
        if args.dry_run:
            continue

        parts = [
            {"type": "text", "text": f"Clip {index + 1} of {len(starts)}, covering {mmss(start)}-{mmss(start + length)} of the walkthrough. Video:"},
            {"type": "video_url", "video_url": {"url": file_data_url(video, "video/mp4")}},
        ]
        if audio:
            parts += [
                {"type": "text", "text": "Audio track of the same clip (the narrator):"},
                {"type": "audio_url", "audio_url": {"url": file_data_url(audio, "audio/wav")}},
            ]
        parts.append({"type": "text", "text": instructions(context)})

        try:
            report, stats = ask_clip(client, parts, args.effort, args.max_tokens)
        except Exception as error:  # keep going so one bad clip doesn't lose the rest
            print(f"  FAILED: {error}")
            timeline.append({"clip": index, "start_s": start, "error": str(error)})
            continue
        for key in ("prompt_tokens", "completion_tokens", "reasoning_tokens", "seconds"):
            totals[key] += stats[key]
        totals["retries"] += stats["attempts"] - 1
        print(f"  {stats['seconds']:.1f}s, {stats['prompt_tokens']:,} in / {stats['completion_tokens']:,} out "
              f"({stats['reasoning_tokens']:,} reasoning)" + (", needed a retry" if stats["attempts"] > 1 else ""))
        print(f"  {report.summary}")
        for c in report.claim_checks:
            print(f"  claim {mmss(start + c.t_s)} {c.verdict.upper()}: {c.claim!r} -> {c.visual_evidence}")
        for c in report.audio_visual_conflicts:
            print(f"  CONFLICT {mmss(start + c.t_s)}: said {c.said!r} / seen {c.seen!r}")
        for o in report.observations:
            if o.severity in ("medium", "high"):
                print(f"  {o.severity.upper()} {o.kind} {mmss(start + o.t_s)} [{o.area}]: {o.description} ({o.evidence})")

        entry = report.model_dump()
        for key in ("spoken_notes", "claim_checks", "observations", "equipment_tags", "audio_visual_conflicts"):
            for item in entry[key]:
                item["t_s"] = round(start + item["t_s"], 1)  # clip-relative -> walkthrough time
        timeline.append({"clip": index, "start_s": start, "stats": stats, **entry})

    if args.dry_run:
        print(f"\nDry run: clips written to {clips_dir}; no API calls made.")
        return

    cost = (totals["prompt_tokens"] * PRICE["spark_in_per_m"] + totals["completion_tokens"] * PRICE["spark_out_per_m"]) / 1e6
    result = {"video": str(src), "effort": args.effort, "totals": totals, "est_cost_usd": round(cost, 4), "clips": timeline}
    ok = sum(1 for c in timeline if "error" not in c)
    print(f"\n{ok}/{len(timeline)} clips parsed, {totals['retries']} retries; {totals['prompt_tokens']:,} in / "
          f"{totals['completion_tokens']:,} out tokens ({totals['reasoning_tokens']:,} reasoning), "
          f"{totals['seconds']:.0f}s total, ~${cost:.3f} at $1.25/$4.25 per 1M (Baseten)")

    claims = [c for clip in timeline if "error" not in clip for c in clip["claim_checks"]]
    if claims and not args.no_verify:
        print(f"\nClaim check on full-resolution stills ({len(claims)} claim(s), Spark 1.3 + SAM 3.1):")
        checked, usage = asyncio.run(verify_claims(src, info, claims, context, out, args.sam_tiles))
        sam_cost = sum(c.get("sam_requests", 0) for c in checked) * PRICE["sam_per_image"]
        result["claim_verification"] = checked
        result["verification_cost_usd"] = round(usage.cost + sam_cost, 4)
        print(f"  Spark 1.3: {usage}; SAM ~${sam_cost:.3f}")
    (out / "report.json").write_text(json.dumps(result, indent=2))
    print(f"Report: {out / 'report.json'}")


if __name__ == "__main__":
    main()
