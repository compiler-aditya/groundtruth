"""Builds what the web app serves and the bundle that is deployed.

  python scripts/build_web.py assets   # public/thumbs/, public/media/, public/examples/: thumbnails, a 720p walk, upload examples
  python scripts/build_web.py record   # public/replays/demo-solar.ndjson: a real run (from the cache) saved as a replay
  python scripts/build_web.py dist     # dist/: app, gt, public, the demo package with file hashes, media, seed cache

These outputs contain third-party sample media (credits in samples/real/SOURCES.md), so they are not committed.
`dist` ships only the cache entries a demo run used (listed by `record`) and no .env: set MODEL_API_KEY (and
BASETEN_API_KEY for uploaded videos) on the host. Deploy with `vercel deploy dist --prod`.
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from gt.drawing import render_sheet  # noqa: E402
from gt.live import LiveRun  # noqa: E402
from gt.media import fit_long_side, load_image  # noqa: E402
from gt.package import Package  # noqa: E402

DEMO = ROOT / "projects" / "demo-solar"
PUBLIC = ROOT / "public"
DIST = ROOT / "dist"
EXAMPLES = ("NP-01", "NP-02", "NP-03")  # the upload page's "use example nameplates", at the size the browser would send
KEYS = ROOT / "out" / "web" / "demo-cache-keys.json"


def assets() -> None:
    package = Package.load(DEMO)
    thumbs = PUBLIC / "thumbs" / "demo-solar"
    thumbs.mkdir(parents=True, exist_ok=True)
    for item in package.items.values():
        dest = thumbs / f"{item.id}.jpg"
        if item.type == "walkthrough_video":
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", "3", "-i", str(item.path), "-frames:v", "1",
                            "-vf", "scale=960:-2", str(dest)], check=True)
            media = PUBLIC / "media" / "demo-solar"
            media.mkdir(parents=True, exist_ok=True)
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(item.path), "-vf", "scale=-2:720", "-c:v", "libx264",
                            "-crf", "28", "-preset", "slow", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart",
                            str(media / "walk.mp4")], check=True)
            continue
        image = render_sheet(str(item.path), 1, 100) if item.type == "drawing_sheet" else load_image(str(item.path))
        fit_long_side(image.convert("RGB"), 960).save(dest, quality=84)
        if item.id in EXAMPLES:
            (PUBLIC / "examples").mkdir(exist_ok=True)
            fit_long_side(image.convert("RGB"), 2000).save(PUBLIC / "examples" / f"{item.id}.jpg", quality=86)
    print(f"thumbnails: {thumbs}; walk video: {PUBLIC / 'media' / 'demo-solar' / 'walk.mp4'}; examples: {PUBLIC / 'examples'}")


def record() -> None:
    """Runs the demo through the web streaming path (Muse Wonder live, checks from the local cache) and saves it."""
    package = Package.load(DEMO)
    run_dir = ROOT / "out" / "web" / "record"
    shutil.rmtree(run_dir, ignore_errors=True)
    holder = {}
    run = LiveRun(package, run_dir, ROOT / "out" / "cache", mode="replay")
    original = run._bind
    run._bind = lambda toolbox: (holder.setdefault("toolbox", toolbox), original(toolbox))
    lines = [line for line in run.stream({"package": "demo-solar", "name": package.name, "captures": len(package.items)})]
    events = [json.loads(line) for line in lines]
    if events[-1]["type"] != "done":
        sys.exit(f"run did not finish: {events[-1]}")
    out = PUBLIC / "replays" / "demo-solar.ndjson"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("".join(line for line in lines if '"type": "ping"' not in line))
    KEYS.parent.mkdir(parents=True, exist_ok=True)
    KEYS.write_text(json.dumps(sorted(holder["toolbox"].cache_keys_used)))
    evaluation = events[-1]["report"].get("evaluation", {})
    print(f"replay: {out} ({out.stat().st_size / 1e6:.1f} MB, {len(events)} events); "
          f"answer key {evaluation.get('found')}/{evaluation.get('expected')}; cache keys: {KEYS}")


def dist() -> None:
    if not KEYS.exists():
        sys.exit("run `record` first: it lists the cache entries the demo needs")
    link = (DIST / ".vercel" / "project.json").read_text() if (DIST / ".vercel" / "project.json").exists() else None
    shutil.rmtree(DIST, ignore_errors=True)
    DIST.mkdir()
    if link:  # keep the Vercel project link across rebuilds
        (DIST / ".vercel").mkdir()
        (DIST / ".vercel" / "project.json").write_text(link)
    for name in ("app.py", "requirements.txt"):
        shutil.copy(ROOT / name, DIST / name)
    shutil.copytree(ROOT / "gt", DIST / "gt", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(PUBLIC, DIST / "public")
    # The demo package with every capture's hash, so its checks come from the seed cache even where a file is absent.
    package = Package.load(DEMO)
    spec = json.loads((DEMO / "project.json").read_text())
    for entry in spec["drawings"] + spec["captures"]:
        item = package.items[entry["id"]]
        item.fingerprint()
        entry["sha256"] = item.sha256
        if item.type != "walkthrough_video":  # the 57 MB video is not shipped; its 720p copy in public/ is for viewing
            rel = item.path.relative_to(ROOT)
            (DIST / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(item.path, DIST / rel)
    target = DIST / "projects" / "demo-solar"
    shutil.copytree(DEMO / "design", target / "design")
    shutil.copy(DEMO / "expected_findings.json", target / "expected_findings.json")
    (target / "project.json").write_text(json.dumps(spec, indent=2))
    shutil.copy(ROOT / "samples" / "real" / "manifest.json", DIST / "samples" / "real" / "manifest.json")
    seed = DIST / "seed_cache"
    for key in json.loads(KEYS.read_text()):  # only result.json and its evidence, not a check's working files
        source = ROOT / "out" / "cache" / key
        (seed / key).mkdir(parents=True)
        shutil.copy(source / "result.json", seed / key / "result.json")
        for name, _ in json.loads((source / "result.json").read_text())["files"]:
            shutil.copy(source / name, seed / key / name)
    (DIST / "vercel.json").write_text(json.dumps({
        "$schema": "https://openapi.vercel.sh/vercel.json",
        "functions": {"app.py": {"maxDuration": 300}},
        "rewrites": [{"source": "/studio", "destination": "/studio.html"}],
    }, indent=2))
    (DIST / ".vercelignore").write_text(".env\n.env.*\n__pycache__/\n")
    size = sum(f.stat().st_size for f in DIST.rglob("*") if f.is_file()) / 1e6
    assert not list(DIST.rglob(".env")), "no .env in the bundle"
    print(f"dist: {DIST} ({size:.0f} MB, {len(json.loads(KEYS.read_text()))} cached results)")


if __name__ == "__main__":
    {"assets": assets, "record": record, "dist": dist}[sys.argv[1] if len(sys.argv) > 1 else "assets"]()
