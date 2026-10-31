"""Equipment nameplates: Muse Spark 1.3 reads a plate into JSON, then checks it against a schedule row."""

import json

from openai import OpenAI
from PIL import Image

from .spark import Usage, image_part, structured, text_part

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


def read_plate(client: OpenAI, image: Image.Image, *, usage: Usage, effort: str = "medium") -> dict:
    return structured(client, [text_part(EXTRACT_PROMPT), image_part(image)], "nameplate", NAMEPLATE_SCHEMA,
                      usage=usage, effort=effort)


def check_against_schedule(client: OpenAI, plate: dict, row: dict, *, usage: Usage, effort: str = "low") -> dict:
    # The tag only finds the row: project tags are rarely on the plate, so checking it would flag every item.
    fields = {k: v for k, v in row.items() if k != "tag"}
    return structured(
        client,
        [text_part(COMPARE_PROMPT + "\n\nSchedule row:\n" + json.dumps(fields) + "\n\nNameplate:\n" + json.dumps(plate))],
        "schedule_check", COMPARE_SCHEMA, usage=usage, effort=effort,
    )
