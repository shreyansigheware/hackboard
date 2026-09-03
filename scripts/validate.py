#!/usr/bin/env python3
"""Validate hackathon rows against schema/hackathon.schema.json.

Dependency-free on purpose: stock python3 on macOS is 3.9 with no pip packages, and the
GitHub runner has python too, so the same checker runs locally and in CI without a install
step. It covers the subset of JSON Schema this project's schema actually uses -- enums,
types, required, patterns, ranges, the scope/city conditional -- plus the cross-field rules
JSON Schema cannot express (ends >= starts, registration_closes <= starts).

Usage:
    python3 scripts/validate.py data/hackathons.json
    python3 scripts/validate.py data/stress-test.json --allow-synthetic

Exit code is 1 if any row fails, so it can gate the merge step in the daily Action.
"""
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = json.loads((ROOT / "schema" / "hackathon.schema.json").read_text())
PROPS = SCHEMA["properties"]
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

TYPES = {
    "string": str,
    "integer": int,
    "boolean": bool,
    "array": list,
    "object": dict,
    "null": type(None),
}


def _type_ok(value, spec):
    names = spec if isinstance(spec, list) else [spec]
    for name in names:
        py = TYPES[name]
        if name == "integer" and isinstance(value, bool):
            continue
        if isinstance(value, py):
            return True
    return False


def _check_scalar(field, value, spec, errors):
    if "enum" in spec:
        if value not in spec["enum"]:
            errors.append(f"{field}: {value!r} not one of {spec['enum']}")
        return
    if "type" in spec and not _type_ok(value, spec["type"]):
        errors.append(f"{field}: expected {spec['type']}, got {type(value).__name__}")
        return
    if isinstance(value, str):
        if "pattern" in spec and not re.match(spec["pattern"], value):
            errors.append(f"{field}: {value!r} does not match {spec['pattern']}")
        if "minLength" in spec and len(value) < spec["minLength"]:
            errors.append(f"{field}: shorter than {spec['minLength']}")
        if "maxLength" in spec and len(value) > spec["maxLength"]:
            errors.append(f"{field}: longer than {spec['maxLength']}")
    if isinstance(value, int) and not isinstance(value, bool):
        if "minimum" in spec and value < spec["minimum"]:
            errors.append(f"{field}: below minimum {spec['minimum']}")


def _parse_date(value):
    try:
        return date(*(int(p) for p in value.split("-")))
    except (ValueError, TypeError):
        return None


def validate_row(row, allow_synthetic=False):
    """Return a list of human-readable errors. Empty list means the row is valid."""
    errors = []
    if not isinstance(row, dict):
        return [f"row is {type(row).__name__}, expected object"]

    for field in SCHEMA["required"]:
        if field not in row:
            errors.append(f"{field}: missing (required)")

    for field in row:
        if field not in PROPS:
            errors.append(f"{field}: not in schema (additionalProperties is false)")

    for field, value in row.items():
        spec = PROPS.get(field)
        if spec is None:
            continue
        if field in ("organiser", "team", "prize") and isinstance(value, dict):
            for sub in spec.get("required", []):
                if sub not in value:
                    errors.append(f"{field}.{sub}: missing (required)")
            for sub, sub_val in value.items():
                sub_spec = spec["properties"].get(sub)
                if sub_spec is None:
                    errors.append(f"{field}.{sub}: not in schema")
                else:
                    _check_scalar(f"{field}.{sub}", sub_val, sub_spec, errors)
            if field == "team":
                lo, hi = value.get("min"), value.get("max")
                if isinstance(lo, int) and isinstance(hi, int) and hi < lo:
                    errors.append(f"team: max {hi} is below min {lo}")
        elif field == "also_seen_at" and isinstance(value, list):
            for link in value:
                if not isinstance(link, str) or not re.match(r"^https?://", link):
                    errors.append(f"also_seen_at: {link!r} is not a URL")
        elif field == "themes" and isinstance(value, list):
            item_spec = spec["items"]
            if not value:
                errors.append("themes: must have at least one theme")
            if len(value) > spec["maxItems"]:
                errors.append(f"themes: more than {spec['maxItems']} themes")
            if len(set(value)) != len(value):
                errors.append("themes: contains duplicates")
            for theme in value:
                if theme not in item_spec["enum"]:
                    errors.append(f"themes: {theme!r} not one of {item_spec['enum']}")
        else:
            _check_scalar(field, value, spec, errors)

    # The scope/city conditional, which is the one allOf branch in the schema.
    if row.get("scope") == "city" and not row.get("city"):
        errors.append("city: required when scope is city")
    if row.get("scope") in ("global", "india") and "city" in row:
        errors.append(f"city: must be omitted when scope is {row['scope']}")

    # Date sanity. The schema's pattern only proves the shape: "2026-13-45" passes it and is
    # not a date. These are exactly the errors an extraction model makes -- a plausible-looking
    # date that is out of range, or a pair in the wrong order.
    parsed = {}
    for field in ("starts", "ends", "registration_closes", "first_seen", "last_seen"):
        raw = row.get(field)
        if not raw:
            continue
        value = _parse_date(raw)
        if value is None:
            errors.append(f"{field}: {raw!r} is not a real date")
        parsed[field] = value

    starts, ends = parsed.get("starts"), parsed.get("ends")
    if starts and ends and ends < starts:
        errors.append(f"ends {row['ends']} is before starts {row['starts']}")
    if bool(row.get("starts")) != bool(row.get("ends")):
        errors.append("starts and ends must both be present or both be null")
    # A row with neither run dates nor a deadline cannot be placed in any month, so it has
    # nowhere to appear and no reason to exist.
    if not row.get("starts") and not row.get("registration_closes"):
        errors.append("no month anchor: needs either run dates or a registration deadline")
    closes = parsed.get("registration_closes")
    if closes and starts and closes > starts:
        errors.append(f"registration_closes {row['registration_closes']} is after starts {row['starts']}")

    first_seen, last_seen = parsed.get("first_seen"), parsed.get("last_seen")
    if first_seen and last_seen and last_seen < first_seen:
        errors.append(f"last_seen {row['last_seen']} is before first_seen {row['first_seen']}")

    if row.get("synthetic") and not allow_synthetic:
        errors.append("synthetic: true is not allowed in the real dataset")

    return errors


def load_events(path):
    """Both data files are {last_updated, events: [...]}; accept a bare list too."""
    payload = json.loads(Path(path).read_text())
    if isinstance(payload, list):
        return payload
    return payload.get("events", [])


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    path = argv[1]
    allow_synthetic = "--allow-synthetic" in argv
    events = load_events(path)

    failures = 0
    seen_ids = {}
    for index, row in enumerate(events):
        errors = validate_row(row, allow_synthetic)
        row_id = row.get("id", f"<row {index}>") if isinstance(row, dict) else f"<row {index}>"
        if row_id in seen_ids:
            errors.append(f"id: duplicate of row {seen_ids[row_id]}")
        else:
            seen_ids[row_id] = index
        if errors:
            failures += 1
            print(f"FAIL {row_id}")
            for error in errors:
                print(f"       {error}")

    total = len(events)
    print(f"\n{total - failures}/{total} rows valid in {path}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
