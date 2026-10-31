"""Generate small synthetic samples with known answers, for smoke-testing the four Day 1 scripts.

Everything here is made up (fictional manufacturer, project and tags). It proves
the pipeline runs end to end and gives exact ground truth to score against,
but it is not a substitute for real drone stills, nameplates, sheets and video.

  python day1/make_samples.py
"""

from __future__ import annotations

import json
import random
import shutil
import subprocess
import sys
from pathlib import Path

import pymupdf
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "samples"
random.seed(7)


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for name in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Helvetica.ttc",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        if Path(name).exists():
            return ImageFont.truetype(name, size)
    return ImageFont.load_default()


def drone_still() -> dict:
    """Top-down solar block: 8 rows x 24 modules, some not yet installed."""
    width, height = 2400, 1500
    img = Image.new("RGB", (width, height), (150, 128, 96))
    noise = Image.effect_noise((width, height), 28).convert("RGB")
    img = Image.blend(img, noise, 0.18)
    draw = ImageDraw.Draw(img)
    rows, cols, pw, ph, gap = 8, 24, 80, 120, 8
    x_start, y_start, row_gap = 120, 80, 50
    missing = {(3, c) for c in range(15, 24)} | {(6, 2), (6, 3), (1, 10)}  # row 4 (index 3) is incomplete
    installed = 0
    for r in range(rows):
        y = y_start + r * (ph + row_gap)
        draw.rectangle((x_start - 10, y + ph // 2 - 4, x_start + cols * (pw + gap), y + ph // 2 + 4), fill=(120, 120, 125))  # torque tube
        for c in range(cols):
            if (r, c) in missing:
                continue
            x = x_start + c * (pw + gap)
            draw.rectangle((x, y, x + pw, y + ph), fill=(28, 42, 92), outline=(200, 205, 210), width=3)
            for gx in range(1, 3):
                draw.line((x + gx * pw // 3, y, x + gx * pw // 3, y + ph), fill=(70, 90, 140), width=1)
            for gy in range(1, 6):
                draw.line((x, y + gy * ph // 6, x + pw, y + gy * ph // 6), fill=(70, 90, 140), width=1)
            installed += 1
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    path = SAMPLES / "drone" / "synthetic_block_a.jpg"
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, quality=90)
    truth = {"image": path.name, "phrase": "solar panel", "design_quantity": rows * cols, "installed": installed,
             "row_4_installed": cols - 9, "note": "synthetic"}
    (path.parent / "ground_truth.json").write_text(json.dumps(truth, indent=2))
    return truth


def nameplate() -> Path:
    img = Image.new("RGB", (1400, 900), (196, 198, 200))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((40, 40, 1360, 860), radius=30, fill=(214, 216, 218), outline=(90, 90, 95), width=6)
    for cx, cy in ((80, 80), (1320, 80), (80, 820), (1320, 820)):
        draw.ellipse((cx - 14, cy - 14, cx + 14, cy + 14), fill=(120, 120, 125))
    draw.text((700, 110), "ACME MOTOR WORKS", font=font(64), fill=(20, 20, 25), anchor="mm")
    draw.text((700, 175), "THREE PHASE INDUCTION MOTOR", font=font(34), fill=(20, 20, 25), anchor="mm")
    rows = [
        ("MODEL", "XP-2150", "SER. NO.", "AMW-26-004417"),
        ("HP", "50", "RPM", "1775"),
        ("VOLTS", "460", "AMPS", "58.2"),
        ("PH", "3", "HZ", "60"),
        ("S.F.", "1.15", "ENCL", "TEFC"),
        ("INS. CL.", "F", "FRAME", "326T"),
        ("NEMA NOM. EFF.", "94.5%", "DATE", "08/2026"),
        ("TAG", "M-101", "", ""),
    ]
    y = 250
    for k1, v1, k2, v2 in rows:
        draw.text((110, y), k1, font=font(30), fill=(40, 40, 45))
        draw.text((420, y), v1, font=font(36), fill=(10, 10, 10))
        if k2:
            draw.text((760, y), k2, font=font(30), fill=(40, 40, 45))
            draw.text((1000, y), v2, font=font(36), fill=(10, 10, 10))
        y += 72
    img = img.rotate(4, resample=Image.BICUBIC, expand=True, fillcolor=(60, 64, 70))
    glare = Image.new("L", img.size, 0)
    ImageDraw.Draw(glare).ellipse((900, 120, 1300, 420), fill=70)
    img = Image.composite(Image.new("RGB", img.size, (255, 255, 255)), img, glare.filter(ImageFilter.GaussianBlur(60)))
    path = SAMPLES / "nameplates" / "M-101.jpg"
    path.parent.mkdir(parents=True, exist_ok=True)
    img.filter(ImageFilter.GaussianBlur(0.8)).save(path, quality=88)
    # Planted issues: schedule says 75 hp (real mismatch) and 480 V (acceptable for a 460 V motor).
    (SAMPLES / "equipment_schedule.csv").write_text(
        "tag,equipment_type,manufacturer,model_number,voltage,power,phase,frequency_hz,enclosure\n"
        "M-101,induction motor,ACME MOTOR WORKS,XP-2150,480 V,75 hp,3,60,TEFC\n"
    )
    return path


def drawing_sheet() -> dict:
    """36x24 in electrical plan with a known number of receptacles and light fixtures."""
    doc = pymupdf.open()
    W, H = 36 * 72, 24 * 72
    page = doc.new_page(width=W, height=H)
    black = (0, 0, 0)
    page.draw_rect(pymupdf.Rect(36, 36, W - 36, H - 36), color=black, width=2)
    tb_x = W - 36 - 360
    page.draw_line((tb_x, 36), (tb_x, H - 36), color=black, width=2)
    rooms = [pymupdf.Rect(120, 120, 900, 760), pymupdf.Rect(900, 120, 1600, 760),
             pymupdf.Rect(120, 760, 900, 1500), pymupdf.Rect(900, 760, 1600, 1500), pymupdf.Rect(1600, 120, 2150, 1500)]
    for rect in rooms:
        page.draw_rect(rect, color=black, width=4)
    names = ["OFFICE 101", "OFFICE 102", "STORAGE 103", "BREAK 104", "ELECTRICAL 105"]
    for rect, name in zip(rooms, names):
        page.insert_text((rect.x0 + 20, rect.y0 + 34), name, fontsize=18)

    def receptacle(x, y):
        page.draw_circle((x, y), 11, color=black, width=1.6)
        page.draw_line((x - 5, y - 18), (x - 5, y + 18), color=black, width=1.6)
        page.draw_line((x + 5, y - 18), (x + 5, y + 18), color=black, width=1.6)

    def fixture(x, y):
        r = pymupdf.Rect(x - 30, y - 15, x + 30, y + 15)
        page.draw_rect(r, color=black, width=1.4)
        page.draw_line(r.tl, r.br, color=black, width=1)
        page.draw_line(r.tr, r.bl, color=black, width=1)

    receptacles = [(140, 300), (140, 600), (500, 740), (880, 450), (920, 300), (1300, 740), (1580, 500),
                   (140, 1000), (500, 1480), (880, 1200), (1250, 1480), (1580, 1100), (1620, 400), (2130, 900)]
    fixtures = [(400, 350), (650, 550), (1150, 350), (1400, 550), (400, 1050), (650, 1300), (1150, 1050),
                (1400, 1300), (1850, 500), (1850, 1100)]
    for p in receptacles:
        receptacle(*p)
    for p in fixtures:
        fixture(*p)
    page.draw_rect(pymupdf.Rect(1980, 160, 2120, 220), color=black, fill=(0.85, 0.85, 0.85), width=2)
    page.insert_text((1995, 200), "LP-1", fontsize=22)
    page.draw_rect(pymupdf.Rect(1700, 1380, 1800, 1460), color=black, width=2)
    page.insert_text((1712, 1428), "TX-1", fontsize=20)
    page.draw_circle((1250, 140), 18, color=black, width=1.5)
    page.insert_text((1278, 148), "EF-1", fontsize=18)

    # Legend
    lx, ly = 160, 1580
    page.insert_text((lx, ly), "LEGEND", fontsize=20)
    receptacle(lx + 20, ly + 40); page.insert_text((lx + 60, ly + 46), "DUPLEX RECEPTACLE, 20A, 120V", fontsize=14)
    fixture(lx + 520, ly + 40); page.insert_text((lx + 570, ly + 46), "2x4 LED TROFFER LIGHT FIXTURE", fontsize=14)
    page.insert_text((lx + 1000, ly + 46), "GENERAL NOTES: 1. ALL RECEPTACLES ON CIRCUITS FROM LP-1.  "
                     "2. MOUNT RECEPTACLES 18 IN AFF UNO.", fontsize=13)

    lines = [("PROJECT", 18), ("SYNTHETIC TEST PROJECT", 15), ("BLOCK A O&M BUILDING", 15), ("", 0),
             ("SHEET TITLE", 18), ("FIRST FLOOR POWER AND", 17), ("LIGHTING PLAN", 17), ("", 0),
             ("DATE: 2026-10-31", 16), ("REVISION: 2", 16), ('SCALE: 1/8" = 1\'-0"', 16), ("DISCIPLINE: ELECTRICAL", 16)]
    y = 120
    for text, size in lines:
        if text:
            page.insert_text((tb_x + 20, y), text, fontsize=size)
        y += 36
    page.insert_text((tb_x + 70, H - 120), "E-101", fontsize=64)
    path = SAMPLES / "drawing" / "E-101_synthetic.pdf"
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(path)
    truth = {"sheet_number": "E-101", "revision": "2", "duplex receptacle": len(receptacles),
             "light fixture": len(fixtures), "tags": ["LP-1", "TX-1", "EF-1"], "note": "synthetic"}
    (path.parent / "ground_truth.json").write_text(json.dumps(truth, indent=2))
    return truth


def walkthrough(drone: Path, plate: Path) -> Path | None:
    """40 s slideshow with spoken narration that contradicts what is shown twice."""
    if not shutil.which("say") or not shutil.which("ffmpeg"):
        print("  skipping video: needs macOS `say` and ffmpeg")
        return None
    work = SAMPLES / "walk"
    work.mkdir(parents=True, exist_ok=True)
    lines = [
        "Block A, tracker row four. Row four is complete, all twenty four modules are installed and clamped. "
        "Moving on.",
        "This is motor M one zero one at the pump skid. The nameplate shows seventy five horsepower, "
        "which matches the schedule.",
    ]
    for i, text in enumerate(lines):
        subprocess.run(["say", "-o", str(work / f"n{i}.aiff"), text], check=True)
    out = work / "synthetic_walk.mp4"
    fit = "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error",
         "-loop", "1", "-t", "20", "-i", str(drone), "-loop", "1", "-t", "20", "-i", str(plate),
         "-i", str(work / "n0.aiff"), "-i", str(work / "n1.aiff"),
         "-filter_complex",
         f"[0:v]{fit}[v0];[1:v]{fit}[v1];[v0][v1]concat=n=2:v=1:a=0[v];"
         "[2:a]apad=whole_dur=20,atrim=0:20[a0];[3:a]apad=whole_dur=20,atrim=0:20[a1];[a0][a1]concat=n=2:v=0:a=1[a]",
         "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
         "-movflags", "+faststart", str(out)],
        check=True,
    )
    for i in range(len(lines)):
        (work / f"n{i}.aiff").unlink()
    (SAMPLES / "area_context.txt").write_text(
        "Block A tracker row 4: 24 modules on tracker T-04 (design).\n"
        "Pump skid motor M-101: induction motor, 75 hp, 480 V, 3 phase, 60 Hz, TEFC (approved schedule).\n"
    )
    return out


def main() -> None:
    print("Writing synthetic samples to", SAMPLES)
    truth = drone_still()
    print(f"  drone still: {truth['installed']} of {truth['design_quantity']} modules installed")
    plate = nameplate()
    print(f"  nameplate: {plate.name} + equipment_schedule.csv (75 hp planted mismatch)")
    sheet = drawing_sheet()
    print(f"  drawing: E-101 with {sheet['duplex receptacle']} receptacles, {sheet['light fixture']} fixtures")
    video = walkthrough(SAMPLES / "drone" / "synthetic_block_a.jpg", plate)
    if video:
        print(f"  walkthrough: {video.name} (narration claims row 4 complete and 75 hp; both are false)")


if __name__ == "__main__":
    sys.exit(main())
