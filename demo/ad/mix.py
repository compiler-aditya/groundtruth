"""Mixes the ad's soundtrack from the ElevenLabs files and the cue list the ad exports (cues.json).

  python3 mix.py AUDIO_DIR OUT.wav [--music N | --music-file F] [--vo-dir D] [--drop-at T] [--pick name=k,...] [--cut A:B]

AUDIO_DIR holds vo_A1.mp3 … vo_A9.mp3, music_1.mp3 … music_4.mp3 and sfx_<name>_<k>.mp3 (k = 1–4, the takes).
- Voiceover: each clip at its cue.
- Music: placed so its drop (the biggest jump in loudness in its first 30 s) lands on the logo hit at 12.4 s, ducked
  under the voice, faded out over the end card. --cut A:B takes music A..B seconds out (whole bars, with a short
  crossfade), to move a later section onto a later beat of the picture.
- Sound effects: the chosen take of each, brought to the voice's level, at every cue, at the cue's gain times a level
  per kind.
The result is normalised to -14 LUFS (two-pass loudnorm), the level the video sites play at.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

SR = 48000
DROP_AT = 12.4
HERE = Path(__file__).parent
MUSIC_DB = -27.0  # the music's typical 1 s level between lines; under the voice it ducks a further 6 dB
VO_DB = -14.0  # the voiceover's loudest 10 ms, in dB; each sound effect is brought to it, then scaled by LEVEL
LEVEL = {"whoosh": 0.32, "click": 0.22, "impact": 0.5, "riser": 0.3, "shutter": 0.28, "scan": 0.22,
         "success": 0.28, "alert": 0.26, "typing": 0.22, "counter": 0.22}


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


def peak_rms_db(x):
    return 20 * np.log10(envelope(x, 0.01).max())


def cut(music, a, b, fade=0.06):
    """Music without a..b seconds, joined with an equal-power crossfade of `fade` seconds."""
    ia, ib, f = int(a * SR), int(b * SR), int(fade * SR)
    t = np.linspace(0, np.pi / 2, f, dtype=np.float32)[:, None]
    joint = music[ia - f:ia] * np.cos(t) + music[ib - f:ib] * np.sin(t)
    return np.concatenate([music[:ia - f], joint, music[ib:]])


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

    vo_dir = Path(args[args.index("--vo-dir") + 1]) if "--vo-dir" in args else audio
    for c in cues["vo"]:
        place(vo, load(vo_dir / f"vo_{c['name']}.mp3"), c["t"])

    cache = {}
    for c in cues["sfx"]:
        name = c["name"]
        if name not in cache:
            x = load(audio / f"sfx_{name}_{picks.get(name, 1)}.mp3")
            cache[name] = x * np.float32(10 ** ((VO_DB - peak_rms_db(x)) / 20))
        place(fx, cache[name], c["t"], c.get("gain", 1) * LEVEL.get(name, 0.4))

    music = load(args[args.index("--music-file") + 1]) if "--music-file" in args else load(audio / f"music_{music_k}.mp3")
    drop_at = float(args[args.index("--drop-at") + 1]) if "--drop-at" in args else DROP_AT
    drop, jump = find_drop(music)
    print(f"music: its entrance at {drop:.1f}s (+{jump:.1f} dB), placed at {drop_at}s")
    lv = 20 * np.log10(np.median(envelope(music[int(max(0, drop) * SR):], 1.0)) + 1e-9)
    music *= np.float32(10 ** ((MUSIC_DB - lv) / 20))  # to the bed's level
    if "--cut" in args:
        a, b = map(float, args[args.index("--cut") + 1].split(":"))
        music = cut(music, a, b)
        print(f"music: took out {a}-{b}s; music after it plays {b - a:.2f}s earlier")
    start = float(args[args.index("--offset") + 1]) if "--offset" in args else drop_at - drop  # or where it starts in the ad
    print(f"music starts at {start:.2f}s in the ad")
    place(mus, music, start, 1.0)
    # duck under the voice: about -9 dB while it speaks
    speaking = np.clip(envelope(vo, 0.01) / 0.02, 0, 1)
    duck = np.repeat(smooth_gain(1 - 0.5 * speaking, 0.05, 0.5, 100), int(0.01 * SR))  # -6 dB under the voice
    duck = np.pad(duck, (0, n - len(duck)), mode="edge").astype(np.float32)
    mus *= duck[:, None]
    # fade out over the end card
    t = np.arange(n) / SR
    mus *= np.clip((dur - 0.3 - t) / 2.5, 0, 1)[:, None].astype(np.float32)

    mix = vo * 1.0 + fx + mus
    peak = np.abs(mix).max()
    if peak > 0.98:
        mix *= 0.98 / peak
    print(f"peak before limiting {peak:.2f}")
    pcm = (np.clip(mix, -1, 1) * 32767).astype("<i2").tobytes()
    raw = ["-f", "s16le", "-ac", "2", "-ar", str(SR), "-i", "-"]
    # two-pass loudness normalisation to -14 LUFS, true peak -1 dB
    m = subprocess.run(["ffmpeg", "-hide_banner", *raw, "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"],
                       input=pcm, capture_output=True, check=True).stderr.decode()
    j = json.loads(m[m.rindex("{"):m.rindex("}") + 1])
    ln = (f"loudnorm=I=-14:TP=-1:LRA=11:measured_I={j['input_i']}:measured_TP={j['input_tp']}:measured_LRA={j['input_lra']}"
          f":measured_thresh={j['input_thresh']}:offset={j['target_offset']}:linear=true")
    subprocess.run(["ffmpeg", "-v", "error", "-y", *raw, "-af", ln, "-ar", str(SR), out_path], input=pcm, check=True)
    print(f"wrote {out_path} (measured {j['input_i']} LUFS, true peak {j['input_tp']} dB)")


if __name__ == "__main__":
    main()
