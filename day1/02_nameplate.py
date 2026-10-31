"""Day 1 test 2: read equipment nameplates into JSON with Muse Spark 1.3, then check them against the schedule.

Extraction uses schema-constrained output (text.format), so every response
parses. If you pass an equipment schedule CSV, a second Spark call compares the
plate with the approved row field by field and flags mismatches.

Go/no-go: on 5+ real nameplate photos, at least 90% of the legible fields are
transcribed exactly, and a planted schedule mismatch is flagged every time.

Schedule CSV: one row per item, a `tag` column plus any fields to check, e.g.
  tag,equipment_type,manufacturer,model_number,voltage,power,phase,frequency_hz
Rows are matched by --tag, else the tag read off the plate, else the image file name.

Examples:
  python day1/02_nameplate.py samples/nameplates --schedule samples/equipment_schedule.csv
  python day1/02_nameplate.py pump.jpg --tag P-301A --schedule schedule.csv --effort high
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from gt.config import meta_client, out_dir  # noqa: E402
from gt.media import expand_inputs, fit_long_side, load_image  # noqa: E402
from gt.spark import Usage, image_part, structured, text_part  # noqa: E402

TEXT = {"type": "string", "description": "Exactly as printed; empty string if absent or unreadable."}

NAMEPLATE_SCHEMA = {
    "type": "object",
    "properties": {
        "legibility": {"type": "string", "enum": ["clear", "partial", "poor"]},
        "equipment_type": {"type": "string", "description": "e.g. induction motor, inverter, transformer; empty if not stated"},
        "equipment_tag": TEXT,
        "manufacturer": TEXT,
        "model_number": TEXT,
        "serial_number": TEXT,
        "manufacture_date": TEXT,
        "ratings": {
            "type": "array",
            "description": "Every rated value on the plate: voltage, current, power, phase, frequency, speed, kVA, impedance, enclosure, insulation class, service factor, efficiency, weight...",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "label as printed, e.g. VOLTS, HP, FLA"},
                    "value": {"type": "string"},
                    "unit": {"type": "string", "description": "unit as printed; empty if none"},
                },
                "required": ["name", "value", "unit"],
                "additionalProperties": False,
            },
        },
        "certification_marks": {"type": "array", "items": {"type": "string"}, "description": "e.g. UL, CSA, CE, NEMA"},
        "unreadable_fields": {"type": "array", "items": {"type": "string"}, "description": "fields visibly present but not readable"},
        "notes": {"type": "string"},
    },
    "required": [
        "legibility", "equipment_type", "equipment_tag", "manufacturer", "model_number", "serial_number",
        "manufacture_date", "ratings", "certification_marks", "unreadable_fields", "notes",
    ],
    "additionalProperties": False,
}

EXTRACT_PROMPT = (
    "This is a photo of an equipment nameplate on a construction site, taken for commissioning verification. "
    "Transcribe exactly what is printed. Do not infer or correct values, and do not fill a field from general "
    "knowledge of the product: if it is not printed on the plate, leave it empty. Keep units and formatting as "
    "printed (e.g. '460/230', '3 PH'). List every rated value under ratings. If glare, angle or damage hides a "
    "field that is clearly there, name it in unreadable_fields."
)

COMPARE_SCHEMA = {
    "type": "object",
    "properties": {
        "fields": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "field": {"type": "string"},
                    "schedule_value": {"type": "string"},
                    "nameplate_value": {"type": "string"},
                    "status": {"type": "string", "enum": ["match", "acceptable", "mismatch", "not_on_nameplate", "unreadable"]},
                    "note": {"type": "string"},
                },
                "required": ["field", "schedule_value", "nameplate_value", "status", "note"],
                "additionalProperties": False,
            },
        },
        "overall": {"type": "string", "enum": ["pass", "review", "fail"]},
        "summary": {"type": "string"},
    },
    "required": ["fields", "overall", "summary"],
    "additionalProperties": False,
}

COMPARE_PROMPT = (
    "Compare an equipment nameplate (as transcribed) with the approved equipment schedule row. For each schedule "
    "field, give the nameplate value and a status: match (same value, allowing formatting differences); acceptable "
    "(different but consistent under standard practice, e.g. a 460 V motor on a 480 V system; explain in note); "
    "mismatch (a real discrepancy someone must resolve); not_on_nameplate; or unreadable. overall is fail if any "
    "field is a mismatch, review if anything is unreadable or not on the nameplate, otherwise pass."
)


def norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def load_schedule(path: str | None) -> list[dict]:
    if not path:
        return []
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    if rows and "tag" not in rows[0]:
        raise SystemExit("The schedule CSV needs a 'tag' column.")
    return rows


def find_row(schedule: list[dict], tag_override: str | None, plate_tag: str, stem: str) -> dict | None:
    for candidate in (tag_override, plate_tag, stem):
        if candidate:
            for row in schedule:
                if norm(row["tag"]) == norm(candidate):
                    return row
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("inputs", nargs="+", help="nameplate photos, folders, or URLs")
    parser.add_argument("--schedule", help="equipment schedule CSV to check against")
    parser.add_argument("--tag", help="schedule tag to compare against (when one image is given)")
    parser.add_argument("--effort", default="medium", choices=["minimal", "low", "medium", "high", "xhigh", "max"])
    parser.add_argument("--max-side", type=int, default=2048)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    sources = expand_inputs(args.inputs)
    schedule = load_schedule(args.schedule)
    out = out_dir("nameplate")
    print(f"{len(sources)} photo(s); schedule rows: {len(schedule)}; reasoning effort: {args.effort}")
    if args.dry_run:
        for source in sources:
            image = fit_long_side(load_image(source), args.max_side)
            print(f"  {source}: sent at {image.width}x{image.height}")
        print("Dry run: no API calls made.")
        return

    client = meta_client()
    usage = Usage()
    summary = []
    for source in sources:
        stem = Path(source.split("?")[0]).stem
        image = fit_long_side(load_image(source), args.max_side)
        plate = structured(
            client, [text_part(EXTRACT_PROMPT), image_part(image)], "nameplate", NAMEPLATE_SCHEMA,
            usage=usage, effort=args.effort,
        )
        result = {"image": source, "nameplate": plate}
        print(f"\n== {stem}: {plate['manufacturer'] or '?'} {plate['model_number'] or '?'} "
              f"(tag {plate['equipment_tag'] or '-'}, legibility {plate['legibility']})")
        for rating in plate["ratings"]:
            print(f"    {rating['name']}: {rating['value']} {rating['unit']}".rstrip())
        if plate["unreadable_fields"]:
            print(f"    unreadable: {', '.join(plate['unreadable_fields'])}")

        row = find_row(schedule, args.tag, plate["equipment_tag"], stem) if schedule else None
        if schedule and row is None:
            print("    no schedule row matched (use --tag)")
        if row:
            # The tag only finds the row: project tags are rarely on the plate, so checking it would flag every item.
            fields = {k: v for k, v in row.items() if k != "tag"}
            check = structured(
                client,
                [text_part(COMPARE_PROMPT + "\n\nSchedule row:\n" + json.dumps(fields) + "\n\nNameplate:\n" + json.dumps(plate))],
                "schedule_check", COMPARE_SCHEMA, usage=usage, effort="low",
            )
            result["schedule_row"] = row
            result["check"] = check
            print(f"    schedule {row['tag']}: {check['overall'].upper()} - {check['summary']}")
            for f in check["fields"]:
                if f["status"] != "match":
                    print(f"      {f['status']:<16} {f['field']}: schedule {f['schedule_value']!r} vs plate {f['nameplate_value']!r}"
                          + (f" ({f['note']})" if f["note"] else ""))
        (out / f"{stem}.json").write_text(json.dumps(result, indent=2))
        summary.append(result)

    (out / "results.json").write_text(json.dumps(summary, indent=2))
    print(f"\nSpark: {usage}\nResults: {out / 'results.json'}")


if __name__ == "__main__":
    main()
