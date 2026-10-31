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
The logic lives in gt/walkthrough.py, which the GroundTruth agent also uses.

Go/no-go: the spoken notes are captured, a planted say-vs-see conflict is
caught, at least 90% of clips return valid JSON without the retry, and
token use and latency per clip are acceptable at the chosen --effort.

Examples:
  python day1/04_walkthrough_spark_open.py samples/walk.mp4
  python day1/04_walkthrough_spark_open.py walk.mov --context-file samples/area_context.txt --effort low --max-clips 2
"""

import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gt.config import out_dir  # noqa: E402
from gt.walkthrough import analyse  # noqa: E402


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
    analyse(
        Path(args.video), out_dir("walkthrough"),
        context=Path(args.context_file).read_text() if args.context_file else "",
        clip_seconds=args.clip_seconds, max_clips=args.max_clips, effort=args.effort, max_tokens=args.max_tokens,
        verify=not args.no_verify, sam_tiles=args.sam_tiles, dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
