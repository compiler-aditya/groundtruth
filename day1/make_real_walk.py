"""Build the real-footage walkthrough for test 4: three CC0 solar-site clips joined, with scripted narration.

The footage is real (Tobi Kellner, CC0, see samples/real/SOURCES.md); the narration is macOS `say`
reading a script with three true and three deliberately false claims, so the answer key is known.

  python day1/make_real_walk.py
"""

import json
import subprocess
from pathlib import Path

WALK = Path(__file__).resolve().parent.parent / "samples" / "real" / "walk"
CLIPS = ["heggelbach_10_topdown.webm", "aasen_01_closeup.webm", "aasen_06_rows.webm"]

# (start time in the joined video, text, truth, what the footage actually shows)
NARRATION = [
    (0.3, "Starting at the Heggelbach agrivoltaic row. A gravel farm track runs along one side of the array.",
     True, "a gravel track runs parallel to the row below the array"),
    (6.8, "Looking straight down, I count forty module strips in this view.",
     False, "13 module strips in view (26 if each strip's two halves are counted separately)"),
    (12.4, "Now at Aasen. Vertical bifacial modules, two stacked in each bay.",
     True, "vertical bifacial modules, two modules high per bay"),
    (17.9, "The modules here are tilted about thirty degrees, facing south.",
     False, "the modules stand vertically, they are not tilted"),
    (23.0, "From the air, a highway runs right along the edge of the array.",
     True, "a multi-lane road with traffic borders the array"),
    (29.0, "The ground between the rows is bare gravel, with no vegetation.",
     False, "grass covers the ground between the rows"),
    (34.0, "That completes the walkthrough.", True, "closing remark, nothing to check"),
]

CONTEXT = (
    "Heggelbach agrivoltaic pilot (design): one elevated row of module strips on a steel frame "
    "above cropland; gravel farm track along one edge.\n"
    "Aasen agrivoltaic plant (design): vertical bifacial modules in fence-like rows, two modules high "
    "per bay; grass maintained between rows; the site borders a highway.\n"
)


def main() -> None:
    work = WALK / "_narration"
    work.mkdir(exist_ok=True)
    inputs, delays = [], []
    for i, (t, text, _, _) in enumerate(NARRATION):
        aiff = work / f"n{i}.aiff"
        subprocess.run(["say", "-o", str(aiff), text], check=True)
        inputs += ["-i", str(aiff)]
        delays.append(f"[{len(CLIPS) + i}:a]adelay={int(t * 1000)}:all=1[a{i}]")

    fit = "scale=1920:1080,setsar=1,fps=30"
    video = "".join(f"[{i}:v]{fit}[v{i}];" for i in range(len(CLIPS)))
    video += "".join(f"[v{i}]" for i in range(len(CLIPS))) + f"concat=n={len(CLIPS)}:v=1:a=0[v]"
    audio = ";".join(delays) + ";" + "".join(f"[a{i}]" for i in range(len(NARRATION)))
    audio += f"amix=inputs={len(NARRATION)}:normalize=0:duration=longest[a]"
    out = WALK / "real_walk.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", *sum((["-i", str(WALK / "clips" / c)] for c in CLIPS), []), *inputs,
         "-filter_complex", f"{video};{audio}", "-map", "[v]", "-map", "[a]",
         "-c:v", "libx264", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", str(out)],
        check=True,
    )
    for f in work.iterdir():
        f.unlink()
    work.rmdir()

    (WALK / "area_context.txt").write_text(CONTEXT)
    truth = [{"t_s": t, "claim": text, "true": ok, "footage_shows": shows} for t, text, ok, shows in NARRATION]
    (WALK / "walk_truth.json").write_text(json.dumps(truth, indent=2))
    print(f"Wrote {out} with {sum(not c['true'] for c in truth)} false claims; answer key in walk_truth.json")


if __name__ == "__main__":
    main()
