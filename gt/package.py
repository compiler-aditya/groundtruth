"""A project package: the design documents and the site captures the agent verifies them against.

  projects/<name>/project.json   name, description, design document paths, drawings, captures
  design/quantities.csv          item_id, area, description, count_what, unit, design_qty, method, tolerance_pct
  design/equipment_schedule.csv  tag plus any fields to check against nameplates
  design/drawing_register.csv    sheet_number, title, current_revision, drawing_id
  design/site_notes.md           design intent per area, used as context for walkthroughs

Paths in project.json are relative to the project folder. The agent only sees capture IDs, types, areas and
labels, never file names, so it has to identify equipment from what the photos show.
"""

import csv
import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

METHODS = {"objects", "tables", "modules", "drawing_symbol"}


@dataclass
class Item:
    """A capture or drawing sheet the agent can point a tool at."""

    id: str
    type: str
    path: Path
    area: str = ""
    label: str = ""
    sha256: str = ""  # declared in project.json when the file itself is not shipped (the hosted demo)

    def public(self) -> dict:
        return {"id": self.id, "type": self.type, "area": self.area, "label": self.label}

    def fingerprint(self) -> str:
        """The file's content hash, for the result cache (the declared one if the file is not present)."""
        if not self.sha256:
            digest = hashlib.sha256()
            with open(self.path, "rb") as f:
                for block in iter(lambda: f.read(1 << 20), b""):
                    digest.update(block)
            self.sha256 = digest.hexdigest()
        return self.sha256[:16]


@dataclass
class Package:
    root: Path
    name: str
    description: str
    quantities: list[dict]
    schedule: list[dict]
    register: list[dict]
    site_notes: str
    items: dict[str, Item] = field(default_factory=dict)

    @classmethod
    def load(cls, root: Path) -> "Package":
        root = root.resolve()
        spec = json.loads((root / "project.json").read_text())
        design = spec.get("design", {})

        def rows(key: str) -> list[dict]:
            path = design.get(key)
            if not path:
                return []
            with open(root / path, newline="") as f:
                return [{k: (v or "").strip() for k, v in row.items()} for row in csv.DictReader(f)]

        package = cls(
            root=root,
            name=spec["name"],
            description=spec.get("description", ""),
            quantities=rows("quantities"),
            schedule=rows("equipment_schedule"),
            register=rows("drawing_register"),
            site_notes=(root / design["site_notes"]).read_text() if design.get("site_notes") else "",
        )
        for d in spec.get("drawings", []):
            package.items[d["id"]] = Item(d["id"], "drawing_sheet", (root / d["path"]).resolve(), "", d.get("label", ""),
                                          d.get("sha256", ""))
        for c in spec.get("captures", []):
            package.items[c["id"]] = Item(c["id"], c["type"], (root / c["path"]).resolve(), c.get("area", ""),
                                          c.get("label", ""), c.get("sha256", ""))
        package.validate()
        return package

    def validate(self) -> None:
        # A file may be absent only when its hash is declared: its checks then come from the result cache.
        missing = [f"{i.id} ({i.path})" for i in self.items.values() if not i.path.exists() and not i.sha256]
        if missing:
            raise FileNotFoundError("Package files not found (run day1/fetch_real_samples.py for samples/real): "
                                    + ", ".join(missing))
        for q in self.quantities:
            if q["method"] not in METHODS:
                raise ValueError(f"{q['item_id']}: method must be one of {sorted(METHODS)}, got {q['method']!r}")
            int(q["design_qty"])

    def quantity(self, item_id: str) -> dict:
        for q in self.quantities:
            if q["item_id"] == item_id:
                return q
        raise KeyError(f"no quantity item {item_id!r}; known: {[q['item_id'] for q in self.quantities]}")

    def schedule_row(self, tag: str) -> dict:
        for row in self.schedule:
            if row["tag"].lower() == tag.lower():
                return row
        raise KeyError(f"no schedule row tagged {tag!r}; known: {[r['tag'] for r in self.schedule]}")

    def item(self, item_id: str, *types: str) -> Item:
        if item_id not in self.items:
            raise KeyError(f"no capture or drawing {item_id!r}; known: {sorted(self.items)}")
        found = self.items[item_id]
        if types and found.type not in types:
            raise ValueError(f"{item_id} is a {found.type}; this tool takes {' or '.join(types)}")
        return found

    def overview(self) -> str:
        """Everything the agent may read about the package, as text for its first message."""
        captures = [i.public() for i in self.items.values()]
        return (
            f"PROJECT: {self.name}\n{self.description}\n\n"
            f"QUANTITIES (design/quantities.csv):\n{json.dumps(self.quantities, indent=1)}\n\n"
            f"EQUIPMENT SCHEDULE (design/equipment_schedule.csv):\n{json.dumps(self.schedule, indent=1)}\n\n"
            f"DRAWING REGISTER (design/drawing_register.csv):\n{json.dumps(self.register, indent=1)}\n\n"
            f"SITE NOTES (design/site_notes.md):\n{self.site_notes}\n\n"
            f"CAPTURES AND DRAWINGS RECEIVED:\n{json.dumps(captures, indent=1)}"
        )
