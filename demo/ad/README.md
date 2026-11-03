# The GroundTruth ad

A 100-second, 1080p30 motion-designed film of GroundTruth for the hackathon submission. Every frame is a function of
time: `ad.html` + `ad.js` lay out frame *t* when the renderer calls `window.seek(t)`, so the cut is exact and repeatable.

The product shots are live, not recordings. The home page's Studio window (Plan, then 3D with the sun moving, then the
walk) and the Studio's Simulate view run in iframes on virtual time (`vt.js`). Their timers, `requestAnimationFrame`,
clock and CSS animations move only when the renderer steps them, one frame at a time, so WebGL renders at full frame
rate even on a slow machine.

Sound is all ElevenLabs:
- the voiceover (nine clips);
- an instrumental track, placed so its drop lands on the logo at 12.4 s and ducked under the voice;
- ten sound effects (whoosh, click, impact, riser, shutter, scan, success, alert, typing, counter) at about 120 cues.

`takes.json` lists the generation of each, and the takes the cut uses. The music starts 2.6 s in, so its drop lands
on the logo. One bar (128 BPM) comes out of its breakdown, so the second drop lands on the 9/9 at 85.3 s. The mix is
normalized to -14 LUFS.
The scene timings follow the voiceover's word timings, from an ElevenLabs transcription.

## Scenes

| Time | Scene | Meta models on screen |
|---|---|---|
| 0–4.5 | The design lines, then the site | |
| 4.5–12.4 | Today: clipboards, photos, trust; mistakes surface at handover | |
| 12.4–16.8 | The logo, built on Meta's models | all four |
| 16.8–32.4 | **Design it**: tool calls lay out a plan, `check_plan` passes; a hand sketch read to scale | Muse Wonder, Muse Spark 1.3 |
| 32.4–47.3 | **Live in it**: live 3D with the real sun, the walk, the simulator's scores, Improve with AI | Muse Wonder |
| 47.3–58.6 | **Prove it**: 12 captures, 9 planted problems, 14 tool calls in the first turn | Muse Wonder |
| 58.6–74.6 | Which model does what: masks, the count, nameplates, the walkthrough | SAM 3.1, Muse Spark 1.3, Muse Spark Open |
| 74.6–84.4 | The model proposes, code decides (the real verdict code), NCR / RFI / OBS | Muse Spark 1.3 |
| 84.4–100.5 | 9/9, 0 false alarms, ~1 min; the end card | |

## Make it

The app must be running on port 8000 (`uvicorn app:app --port 8000`). Then:

```bash
cd demo/ad
node render.js 0 100.5 1 frames          # every frame; `node render.js 0 100.5 15 prev` for a 2 fps preview
python3 mix.py AUDIO_DIR mix.wav --music 2 --cut 78.9:80.775 \
  --pick whoosh=3,click=3,impact=3,riser=4,shutter=4,scan=1,success=2,alert=2,typing=3,counter=3
                                         # AUDIO_DIR: vo_A1..A9.mp3, music_1..4.mp3, sfx_<name>_1..4.mp3
./encode.sh frames groundtruth-ad.mp4 mix.wav
```

To render faster, render three stretches in parallel. Each one loads only the live frames it shows:

```bash
FRAMES=vt-hero node render.js 0 33.65 1 frames &
FRAMES=vt-hero2,vt-studio node render.js 33.65 47.3 1 frames &
FRAMES= node render.js 47.3 100.5 1 frames &
wait
```

The renderer also writes `cues.json`, which lists the voiceover and sound-effect cues that `mix.py` reads.
- `mix.py --music 2` picks another music take.
- `--pick whoosh=3,impact=2` picks other sound-effect takes.
- `THREE_DIR` points the renderer at a local copy of three@0.160.0, for machines without CDN access.
- `STUB_DIR` points it at a stand-in demo package, for machines without the sample media.
