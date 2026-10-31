"""Download the openly licensed real samples listed in samples/real/manifest.json and check their SHA-256.

The media is third-party (credits in samples/real/SOURCES.md), so it is not committed; this puts it back.
Files that are already present with the right checksum are skipped. Afterwards it rebuilds the narrated
walkthrough video from the CC0 clips (day1/make_real_walk.py) unless --no-walk.

  python day1/fetch_real_samples.py
"""

import argparse
import hashlib
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

REAL = Path(__file__).resolve().parent.parent / "samples" / "real"
USER_AGENT = "GroundTruth/0.1 (hackathon sample fetcher)"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--no-walk", action="store_true", help="don't rebuild walk/real_walk.mp4")
    args = parser.parse_args()

    manifest = json.loads((REAL / "manifest.json").read_text())
    failed = []
    for item in manifest["files"]:
        dest = REAL / item["path"]
        if dest.exists() and sha256(dest) == item["sha256"]:
            print(f"  ok      {item['path']}")
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(item["url"], headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=120) as response:
            dest.write_bytes(response.read())
        if sha256(dest) != item["sha256"]:
            failed.append(item["path"])
            print(f"  CHANGED {item['path']} (checksum differs from the manifest; the source file was updated)")
        else:
            print(f"  fetched {item['path']} ({item['bytes'] / 1e6:.1f} MB, {item['license']})")
    if failed:
        sys.exit(f"{len(failed)} file(s) differ from the manifest: {failed}")
    if not args.no_walk:
        subprocess.run([sys.executable, str(Path(__file__).with_name("make_real_walk.py"))], check=True)


if __name__ == "__main__":
    main()
