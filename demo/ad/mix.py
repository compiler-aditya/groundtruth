"""Mixes the ad's soundtrack from the ElevenLabs files and the cue list the ad exports (cues.json).

  python3 mix.py AUDIO_DIR OUT.wav [--music N] [--pick name=k,...]

AUDIO_DIR holds vo_A1.mp3 … vo_A9.mp3, music_1.mp3 … music_4.mp3 and sfx_<name>_<k>.mp3 (k = 1–4, the takes).
- Voiceover: each clip at its cue.
- Music: placed so its drop (the biggest jump in loudness in its first 30 s) lands on the logo hit at 12.4 s, ducked
  under the voice, faded out over the end card.
- Sound effects: the chosen take of each, at every cue, at the cue's gain times a level per kind.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

SR = 48000
DROP_AT = 12.4
HERE = Path(__file__).parent
LEVEL = {"whoosh": 0.45, "click": 0.3, "impact": 0.8, "riser": 0.45, "shutter": 0.35, "scan": 0.3,
         "success": 0.35, "alert": 0.35, "typing": 0.3, "counter": 0.3}


def load(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()


def place(out, clip, t, gain=1.0):
    i = int(round(t * SR))
    if i < 0:
        clip, i = clip[-i:], 0
    n = min(len(clip), len(out) - i)
    if n > 0:
        out[i:i + n] += clip[:n] * gain


def envelope(x, win):
    """RMS in windows of `win` seconds, one value per window."""
    m = x.mean(axis=1)
    k = int(win * SR)
    n = len(m) // k
    return np.sqrt((m[:n * k].reshape(n, k) ** 2).mean(axis=1) + 1e-12)


def find_drop(music):
    env = envelope(music[: 30 * SR], 0.1)
    db = 20 * np.log10(env)
    # the loudness of the next second against the second before, in tenths of a second
    best, at = -1e9, 0
    for i in range(10, len(db) - 10):
        jump = db[i:i + 10].mean() - db[i - 10:i].mean()
        if jump > best:
            best, at = jump, i
    return at * 0.1, best


def smooth_gain(target, attack, release, rate):
    """One-pole smoothing at `rate` values a second: fast to duck (attack), slow to come back (release)."""
    g = np.empty_like(target)
    a, r = np.exp(-1 / (attack * rate)), np.exp(-1 / (release * rate))
    cur = target[0]
    for i, x in enumerate(target):
        c = a if x < cur else r
        cur = c * cur + (1 - c) * x
        g[i] = cur
    return g


def main():
    audio, out_path = Path(sys.argv[1]), sys.argv[2]
    args = sys.argv[3:]
    music_k = int(args[args.index("--music") + 1]) if "--music" in args else 1
    picks = {}
    if "--pick" in args:
        for kv in args[args.index("--pick") + 1].split(","):
            name, k = kv.split("=")
            picks[name] = int(k)
    cues = json.loads((HERE / "cues.json").read_text())
    dur = cues["duration"]
    n = int(dur * SR)
    vo, fx, mus = np.zeros((n, 2), np.float32), np.zeros((n, 2), np.float32), np.zeros((n, 2), np.float32)

    for c in cues["vo"]:
        place(vo, load(audio / f"vo_{c['name']}.mp3"), c["t"])

    cache = {}
    for c in cues["sfx"]:
        name = c["name"]
        if name not in cache:
            cache[name] = load(audio / f"sfx_{name}_{picks.get(name, 1)}.mp3")
        place(fx, cache[name], c["t"], c.get("gain", 1) * LEVEL.get(name, 0.4))

    music = load(audio / f"music_{music_k}.mp3")
    drop, jump = find_drop(music)
    print(f"music {music_k}: drop at {drop:.1f}s (+{jump:.1f} dB), placed at {DROP_AT}s")
    place(mus, music, DROP_AT - drop, 1.0)
    # duck under the voice: about -9 dB while it speaks
    speaking = np.clip(envelope(vo, 0.01) / 0.02, 0, 1)
    duck = np.repeat(smooth_gain(1 - 0.65 * speaking, 0.03, 0.35, 100), int(0.01 * SR))
    duck = np.pad(duck, (0, n - len(duck)), mode="edge").astype(np.float32)
    mus *= (0.5 * duck)[:, None]
    # fade out over the end card
    t = np.arange(n) / SR
    mus *= np.clip((dur - 0.3 - t) / 2.5, 0, 1)[:, None].astype(np.float32)

    mix = vo * 1.0 + fx + mus
    peak = np.abs(mix).max()
    if peak > 0.98:
        mix *= 0.98 / peak
    print(f"peak before limiting {peak:.2f}")
    pcm = (np.clip(mix, -1, 1) * 32767).astype("<i2").tobytes()
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ac", "2", "-ar", str(SR), "-i", "-", out_path], input=pcm, check=True)
    print("wrote", out_path)


if __name__ == "__main__":
    main()
