"""The time map from the picture's original timing (cut to the first voiceover) to a new voiceover.

  python3 build_warp.py WORDS_DIR OUT.json

WORDS_DIR holds old_A1.json … old_A9.json and new_A1.json … new_A9.json (ElevenLabs transcription word timings).
Anchors pair the start of each phrase in the old read with the same phrase in the new one, and the end of each line;
the picture is stretched piecewise-linearly between them, so every beat stays on its word. The gap between two lines
keeps its old length, so transitions keep their speed. Out: {"anchors": [[old, new], ...], "duration", "vo": {name: start}}.
"""
import difflib
import json
import re
import sys
from pathlib import Path

OLD_START = {"A1": 0.4, "A2": 4.6, "A3": 12.9, "A4": 17.6, "A5": 32.45, "A6": 47.0, "A7": 58.6, "A8": 74.9, "A9": 84.6}
OLD_DURATION = 100.5


def words(path):
    ws = [w for w in json.loads(Path(path).read_text())["words"] if w.get("type", "word") == "word"]
    out, inside = [], False
    for w in ws:  # drop delivery tags like "[calm and confident]": they are not spoken
        t = w["text"]
        if t.startswith("["):
            inside = True
        if not inside:
            out.append(w)
        if t.endswith("]"):
            inside = False
    return out


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def main():
    d, out = Path(sys.argv[1]), sys.argv[2]
    anchors, vo = [], {}
    prev = None  # (old end abs, new end abs) of the line before
    for name, s_old in OLD_START.items():
        wo, wn = words(d / f"old_{name}.json"), words(d / f"new_{name}.json")
        m = difflib.SequenceMatcher(a=[norm(w["text"]) for w in wo], b=[norm(w["text"]) for w in wn], autojunk=False)
        pairs = [(i + k, j + k) for i, j, n in m.get_matching_blocks() for k in range(n)]
        assert pairs and pairs[0] == (0, 0), (name, "first words differ")
        first_old = s_old + wo[0]["start"]
        if prev is None:
            s_new = first_old - wn[0]["start"]          # the first line starts where it did
        else:
            gap = first_old - prev[0]                    # the pause before this line, as it was
            s_new = prev[1] + gap - wn[0]["start"]
        vo[name] = round(s_new, 3)
        for i, j in pairs:
            starts_phrase = i == 0 or re.search(r"[.,?!]$", wo[i - 1]["text"])
            if starts_phrase:
                anchors.append([s_old + wo[i]["start"], s_new + wn[j]["start"]])
        anchors.append([s_old + wo[-1]["end"], s_new + wn[-1]["end"]])
        prev = (s_old + wo[-1]["end"], s_new + wn[-1]["end"])
        print(f"{name}: old {s_old:6.2f}  new {s_new:6.2f}  ({len(pairs)}/{len(wo)} words matched)")
    anchors.sort()
    clean = [[0.0, 0.0]] if anchors[0][0] > 0 else []
    if clean and anchors[0][1] < 0:
        clean = []
    for a in anchors:
        if not clean or (a[0] > clean[-1][0] + 1e-3 and a[1] > clean[-1][1] + 1e-3):
            clean.append([round(a[0], 3), round(a[1], 3)])
    # before the first anchor and after the last, a plain shift
    if clean[0] != [0.0, 0.0]:
        clean.insert(0, [0.0, round(clean[0][1] - clean[0][0], 3)])
    end = OLD_DURATION + (clean[-1][1] - clean[-1][0])
    clean.append([OLD_DURATION, round(end, 3)])
    ratios = [(b[1] - a[1]) / (b[0] - a[0]) for a, b in zip(clean, clean[1:])]
    print(f"{len(clean)} anchors; stretch {min(ratios):.2f}..{max(ratios):.2f}; duration {OLD_DURATION} -> {end:.2f}s")
    Path(out).write_text(json.dumps({"anchors": clean, "duration": round(end, 3), "vo": vo}, indent=1))


if __name__ == "__main__":
    main()
