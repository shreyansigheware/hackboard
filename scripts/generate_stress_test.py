#!/usr/bin/env python3
"""Generate data/stress-test.json -- 1,000 synthetic rows for the performance bar.

The issue's performance targets (60fps scroll, sub-100ms filter, flat DOM node count) are
measured at 1,000 items, not at 40. This builds that set.

Two rules it follows deliberately:

1. Rows are marked "synthetic": true and named so nobody can mistake one for a real event.
   The validator refuses a synthetic row in data/hackathons.json for the same reason.
2. The shape is drawn from the real rows in data/hackathons.json when there are any, so the
   stress set has the same distribution the UI will really face -- the same clustering of
   cities, the same proportion of missing deadlines. A uniform random set is easier to make
   and would hide exactly the layout problems worth finding.

Deterministic: same seed in, same file out, so a performance comparison between two commits
is measuring the code and not a different dataset.

Usage:
    python3 scripts/generate_stress_test.py [count] [--seed N]
"""
import json
import random
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REAL = ROOT / "data" / "hackathons.json"
OUT = ROOT / "data" / "stress-test.json"

# Fallback shape, used until data/hackathons.json has real rows to learn from. These are
# distributions, not events -- weighted so the set clusters the way the real one will.
CITIES = [
    ("Bangalore", 26), ("Hyderabad", 14), ("Delhi NCR", 14), ("Mumbai", 12),
    ("Pune", 10), ("Chennai", 8), ("Kolkata", 5), ("Ahmedabad", 4),
    ("Jaipur", 3), ("Kochi", 2), ("Indore", 2),
]
SCOPES = [("india", 55), ("city", 30), ("global", 15)]
MODES = [("online", 45), ("in-person", 35), ("hybrid", 20)]
ORG_TYPES = [("community", 35), ("university", 30), ("company", 25), ("government", 10)]
THEMES = [
    ("ai", 32), ("open-source", 14), ("fintech", 12), ("web3", 10),
    ("cybersecurity", 9), ("healthtech", 8), ("sustainability", 7),
    ("hardware", 5), ("other", 3),
]
ELIGIBILITY = [("open", 55), ("students", 32), ("women", 8), ("freshers", 5)]
ORG_NAMES = [
    "Meridian Labs", "Northgate University", "Openstack Collective", "Civic Data Office",
    "Bluefin Systems", "Institute of Applied Computing", "DevCircle", "Statewide IT Mission",
    "Harborview Tech", "Polytechnic of Applied Sciences", "BuildersGuild", "Redshift Analytics",
]
QUALIFIERS = ["Sprint", "Challenge", "Jam", "Summit Hack", "Datathon", "CTF", "Ideathon", "Build"]


def weighted(rng, pairs):
    values, weights = zip(*pairs)
    return rng.choices(values, weights=weights, k=1)[0]


def learn_from_real(events):
    """Rebuild the weight tables from real rows, so the stress set matches reality."""
    def tally(key_fn):
        counts = {}
        for event in events:
            value = key_fn(event)
            if value is None:
                continue
            counts[value] = counts.get(value, 0) + 1
        return sorted(counts.items(), key=lambda kv: -kv[1]) or None

    learned = {
        "scopes": tally(lambda e: e.get("scope")),
        "modes": tally(lambda e: e.get("mode")),
        "org_types": tally(lambda e: (e.get("organiser") or {}).get("type")),
        "eligibility": tally(lambda e: e.get("eligibility")),
        "cities": tally(lambda e: e.get("city")),
    }
    theme_counts = {}
    for event in events:
        for theme in event.get("themes", []):
            theme_counts[theme] = theme_counts.get(theme, 0) + 1
    learned["themes"] = sorted(theme_counts.items(), key=lambda kv: -kv[1]) or None
    return learned


def build(count, seed, today):
    rng = random.Random(seed)

    real_events = []
    if REAL.exists():
        payload = json.loads(REAL.read_text())
        real_events = payload if isinstance(payload, list) else payload.get("events", [])

    learned = learn_from_real(real_events) if len(real_events) >= 20 else {}
    scopes = learned.get("scopes") or SCOPES
    modes = learned.get("modes") or MODES
    org_types = learned.get("org_types") or ORG_TYPES
    themes = learned.get("themes") or THEMES
    eligibility = learned.get("eligibility") or ELIGIBILITY
    cities = learned.get("cities") or CITIES

    rows = []
    for index in range(count):
        # Spread across a year centred on today, so month navigation has something either
        # side and the "closes this week" filter has real edge cases to hit.
        starts = today + timedelta(days=rng.randint(-180, 185))
        ends = starts + timedelta(days=weighted(rng, [(1, 20), (2, 45), (3, 25), (7, 7), (30, 3)]))

        # A third of real listings never state a registration deadline. Keeping that hole in
        # the synthetic set is the point -- the UI has to render the gap without breaking.
        if rng.random() < 0.33:
            registration_closes = None
        else:
            registration_closes = starts - timedelta(days=rng.randint(0, 30))

        if rng.random() < 0.28:
            prize_inr = None
        elif rng.random() < 0.08:
            prize_inr = 0
        else:
            prize_inr = rng.choice([10, 25, 50, 100, 200, 300, 500, 1000, 2500]) * 1000

        scope = weighted(rng, scopes)
        team_min = weighted(rng, [(1, 55), (2, 35), (3, 10)])
        team_max = weighted(rng, [(4, 50), (5, 20), (6, 10), (2, 10), (None, 10)])
        if team_max is not None and team_max < team_min:
            team_max = team_min

        row = {
            "id": f"synthetic-{index:04d}-{starts:%Y-%m}",
            "name": f"[SYNTHETIC] {rng.choice(ORG_NAMES).split()[0]} {rng.choice(QUALIFIERS)} {index:04d}",
            "organiser": {
                "name": f"[SYNTHETIC] {rng.choice(ORG_NAMES)}",
                "type": weighted(rng, org_types),
            },
            "scope": scope,
            "mode": weighted(rng, modes),
            "themes": rng.sample(
                [t for t, _ in themes], k=weighted(rng, [(1, 45), (2, 35), (3, 15), (4, 5)])
            ),
            "starts": starts.isoformat(),
            "ends": ends.isoformat(),
            "registration_closes": registration_closes.isoformat() if registration_closes else None,
            "prize_inr": prize_inr,
            "team": {"min": team_min, "max": team_max},
            "eligibility": weighted(rng, eligibility),
            "url": f"https://example.invalid/synthetic/{index:04d}",
            "source_url": "https://example.invalid/synthetic",
            "first_seen": today.isoformat(),
            "last_seen": today.isoformat(),
            "locked": False,
            "synthetic": True,
        }
        if scope == "city":
            row["city"] = weighted(rng, cities)
        rows.append(row)

    return {
        "last_updated": today.isoformat(),
        "generated_by": "scripts/generate_stress_test.py",
        "synthetic": True,
        "note": "Performance fixture only. Every row is fake and marked synthetic. Never serve this as real data.",
        "seed": seed,
        "learned_from_real_rows": len(real_events) if learned else 0,
        "events": rows,
    }


def main(argv):
    count = 1000
    seed = 20260903
    positional = [a for a in argv[1:] if not a.startswith("--")]
    if positional:
        count = int(positional[0])
    if "--seed" in argv:
        seed = int(argv[argv.index("--seed") + 1])

    payload = build(count, seed, date.today())
    OUT.write_text(json.dumps(payload, indent=2) + "\n")
    learned = payload["learned_from_real_rows"]
    shape = f"shaped from {learned} real rows" if learned else "using fallback distributions"
    print(f"wrote {len(payload['events'])} synthetic rows to {OUT.relative_to(ROOT)} ({shape}, seed {seed})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
