#!/usr/bin/env python3
"""Fetch the enabled seeds, normalise them to the schema, and merge into data/hackathons.json.

Three of the five seeds turned out to expose structured JSON -- Devpost and Unstop as public
API endpoints, MLH as a Next.js payload embedded in the page. For those, mapping fields
directly beats handing page text to a model: it is deterministic, free, and it cannot invent
a date. The model-extraction path stays for the seeds that have no feed (Devfolio renders
client-side and ships no listings in its HTML), and is not built yet.

What it does:

  1. Fetches each enabled seed. A seed that fails is logged and skipped -- one bad source must
     never fail the run or wipe good data.
  2. Normalises rows to schema/hackathon.schema.json.
  3. Validates every row. Anything that fails is dropped and logged, never merged.
  4. Dedupes across sources on normalised name + start date, keeping the richer record and
     both source URLs.
  5. Merges into the existing file without overwriting rows marked "locked": true.
  6. Moves anything already over into data/archive.json.

Usage:
    python3 scripts/fetch_sources.py            # fetch, merge, write
    python3 scripts/fetch_sources.py --dry-run  # fetch and report, write nothing
"""
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate import validate_row  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "hackathons.json"
ARCHIVE = ROOT / "data" / "archive.json"

# A real User-Agent with the repo URL in it: these sites are hosts, not endpoints.
UA = "hackboard/0.1 (+https://github.com/shreyansigheware/hackboard)"
TODAY = date.today()

THEME_MAP = {
    "machine learning": "ai", "artificial intelligence": "ai", "ai": "ai", "ml": "ai",
    "data science": "ai", "generative ai": "ai", "agentic ai": "ai", "llm": "ai",
    "blockchain": "web3", "web3": "web3", "crypto": "web3", "nft": "web3",
    "fintech": "fintech", "finance": "fintech", "banking": "fintech", "payments": "fintech",
    "health": "healthtech", "healthtech": "healthtech", "medtech": "healthtech",
    "cybersecurity": "cybersecurity", "security": "cybersecurity", "ctf": "cybersecurity",
    "open ended": "other", "open source": "open-source", "opensource": "open-source",
    "sustainability": "sustainability", "climate": "sustainability", "environment": "sustainability",
    "social good": "sustainability", "hardware": "hardware", "iot": "hardware",
    "robotics": "hardware", "internet of things": "hardware",
}

INDIAN_CITIES = {
    "bangalore": "Bangalore", "bengaluru": "Bangalore", "hyderabad": "Hyderabad",
    "mumbai": "Mumbai", "navi mumbai": "Mumbai", "pune": "Pune", "chennai": "Chennai",
    "delhi": "Delhi NCR", "new delhi": "Delhi NCR", "noida": "Delhi NCR",
    "gurugram": "Delhi NCR", "gurgaon": "Delhi NCR", "ghaziabad": "Delhi NCR",
    "kolkata": "Kolkata", "ahmedabad": "Ahmedabad", "jaipur": "Jaipur", "kochi": "Kochi",
    "indore": "Indore", "bhopal": "Bhopal", "lucknow": "Lucknow", "chandigarh": "Chandigarh",
    "coimbatore": "Coimbatore", "vellore": "Vellore", "surat": "Surat", "nagpur": "Nagpur",
}


def log(message):
    print(message, file=sys.stderr)


def fetch(url, timeout=30):
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", "replace")


def slugify(text):
    slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return re.sub(r"-{2,}", "-", slug)[:60] or "event"


def anchor(event):
    """The date a row is placed by. Run dates when they exist, otherwise the deadline --
    every valid row has at least one, which is what the validator enforces."""
    return event.get("starts") or event.get("registration_closes")


def last_relevant_day(event):
    """The day after which a row is over: the end of the run, or the deadline if the run
    dates were never published."""
    return event.get("ends") or event.get("registration_closes")


def months_for(event):
    """The documented month rule, applied: a row appears in a month if its run dates overlap
    it, or its registration deadline falls in it. Kept here so the rule has exactly one
    implementation and the README is describing real behaviour."""
    months = set()
    starts, ends = event.get("starts"), event.get("ends")
    if starts and ends:
        y, m = int(starts[:4]), int(starts[5:7])
        while (y, m) <= (int(ends[:4]), int(ends[5:7])):
            months.add(f"{y:04d}-{m:02d}")
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    if event.get("registration_closes"):
        months.add(event["registration_closes"][:7])
    return sorted(months)


def norm_key(name, starts):
    """Dedupe key. Strips edition numbers so 'HackX 3.0' and 'HackX' collide when they share
    a start date, which is the usual shape of a cross-listing."""
    base = re.sub(r"[^a-z0-9]+", "", (name or "").lower())
    base = re.sub(r"(20\d\d|\d+0)$", "", base)
    return f"{base}|{starts}"


def map_themes(values):
    out = []
    for raw in values or []:
        low = str(raw).lower()
        for needle, theme in THEME_MAP.items():
            if needle in low and theme not in out:
                out.append(theme)
                break
    return out[:6] or ["other"]


def place(text):
    """Return (scope, city). Only recognises cities on an explicit list -- guessing a city
    from a free-text location is how a Bangalore filter starts lying."""
    low = (text or "").lower()
    if not low or "online" in low or "virtual" in low or "anywhere" in low:
        return "global", None
    for needle, city in sorted(INDIAN_CITIES.items(), key=lambda kv: -len(kv[0])):
        if re.search(rf"\b{re.escape(needle)}\b", low):
            return "city", city
    if "india" in low:
        return "india", None
    return "global", None


def iso(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return None


# --------------------------------------------------------------------------- devpost
DEVPOST_RANGE = re.compile(
    r"([A-Z][a-z]{2})\s+(\d{1,2})(?:,\s*(\d{4}))?\s*-\s*([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})"
)
MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


def devpost_dates(text):
    match = DEVPOST_RANGE.search(text or "")
    if not match:
        return None, None
    m1, d1, y1, m2, d2, y2 = match.groups()
    y2 = int(y2)
    y1 = int(y1) if y1 else (y2 - 1 if MONTHS[m1] > MONTHS[m2] else y2)
    try:
        return (date(y1, MONTHS[m1], int(d1)).isoformat(),
                date(y2, MONTHS[m2], int(d2)).isoformat())
    except ValueError:
        return None, None


def from_devpost(row):
    starts, ends = devpost_dates(row.get("submission_period_dates"))
    if not starts or not ends:
        return None
    location = (row.get("displayed_location") or {}).get("location", "")
    scope, city = place(location)
    amount = re.sub(r"[^\d]", "", row.get("prize_amount") or "")
    event = {
        "id": f"{slugify(clean_title(row.get('title')))}-{starts[:7]}",
        "name": clean_title(row.get("title")),
        "organiser": {"name": (row.get("organization_name") or "Devpost").strip(), "type": "company"},
        "scope": scope,
        "mode": "online" if scope == "global" and "online" in location.lower() else ("in-person" if city else "online"),
        "themes": map_themes([t.get("name") for t in row.get("themes") or []]),
        "starts": starts,
        "ends": ends,
        # Devpost states a submission window, not a separate registration deadline. Leaving
        # this null is correct; inferring one would be inventing a date.
        "registration_closes": None,
        "prize": {"amount": int(amount), "currency": "USD"} if amount else None,
        "team": {"min": 1, "max": None},
        "eligibility": "open",
        "url": row.get("url") or "https://devpost.com",
        "source": "devpost",
        "source_url": "https://devpost.com/hackathons",
        "first_seen": TODAY.isoformat(),
        "last_seen": TODAY.isoformat(),
        "locked": False,
    }
    if city:
        event["city"] = city
    return event


# --------------------------------------------------------------------------- unstop
UNSTOP_CURRENCY = {"fa-rupee": "INR", "fa-dollar": "USD", "fa-euro": "EUR", "fa-gbp": "GBP"}

# Marketing tails Unstop titles carry: "... - 4K+ Registrations", "| Win Rs 50,000".
TITLE_TAIL = re.compile(
    r"\s*[-–—|]\s*(?:win\b|prizes?\b|\d[\d,.]*\s*k?\+?\s*registrations?|register\b|apply\b).*$",
    re.I)


def clean_title(text):
    text = (text or "").strip().strip('"\u201c\u201d\'')
    text = TITLE_TAIL.sub("", text)
    return re.sub(r"\s{2,}", " ", text).strip()


def from_unstop(row):
    """Unstop's listing API publishes a registration window and no run dates at all --
    start_date is null on every row, and end_date mirrors the registration deadline about
    half the time. So run dates stay null and the deadline carries the row. Fetching the
    event page would give real run dates; that is the one-hop step, not this one."""
    reqs = row.get("regnRequirements") or {}
    closes = iso(reqs.get("end_regn_dt")) or iso(row.get("end_date"))
    if not closes:
        return None

    addr = row.get("address_with_country_logo") or {}
    locations = row.get("locations") or []
    first_loc = locations[0] if locations else {}
    city_raw = addr.get("city") or first_loc.get("city") or ""
    country = addr.get("country") or first_loc.get("country") or ""
    state = addr.get("state") or first_loc.get("state") or ""
    region = (row.get("region") or "").lower()

    if region == "online":
        mode, scope, city, location = "online", "india", None, None
    else:
        mode = "in-person"
        scope, city = place(city_raw)
        if scope != "city":
            scope = "india" if (country or "India").strip().lower() == "india" else "global"
        location = ", ".join(x for x in (city_raw, state) if x) or None

    prize = None
    best = 0
    currency = "INR"
    for entry in row.get("prizes") or []:
        try:
            cash = int(float(entry.get("cash") or 0))
        except (TypeError, ValueError):
            continue
        if cash > best:
            best, currency = cash, UNSTOP_CURRENCY.get(entry.get("currency"), "OTHER")
    if best > 0:
        prize = {"amount": best, "currency": currency}

    filters = " ".join(f.get("name", "") for f in row.get("filters") or []).lower()
    if "women" in filters:
        eligibility = "women"
    elif any(w in filters for w in ("undergraduate", "student", "school", "postgraduate", "engineering")):
        eligibility = "students"
    else:
        eligibility = "open"

    try:
        team_min = max(1, int(reqs.get("min_team_size") or 1))
    except (TypeError, ValueError):
        team_min = 1
    try:
        team_max = int(reqs.get("max_team_size")) if reqs.get("max_team_size") else None
    except (TypeError, ValueError):
        team_max = None
    if team_max is not None and team_max < team_min:
        team_max = team_min

    org = (row.get("organisation") or {}).get("name") or "Unstop"
    name = clean_title(row.get("title"))
    if len(name) < 2:
        return None

    event = {
        "id": f"{slugify(name)}-{closes[:7]}",
        "name": name,
        "organiser": {
            "name": org.strip(),
            "type": "university" if re.search(r"universit|college|institute|school|iit|nit|academy", org, re.I) else "company",
        },
        "scope": scope,
        "mode": mode,
        "themes": map_themes(
            [f.get("name") for f in row.get("filters") or []]
            + [name] + list(row.get("required_skills") or [])
        ),
        "starts": None,
        "ends": None,
        "registration_closes": closes,
        "prize": prize,
        "team": {"min": team_min, "max": team_max},
        "eligibility": eligibility,
        "url": f"https://unstop.com/{row.get('public_url')}" if row.get("public_url") else "https://unstop.com",
        "source": "unstop",
        "source_url": "https://unstop.com/hackathons",
        "first_seen": TODAY.isoformat(),
        "last_seen": TODAY.isoformat(),
        "locked": False,
    }
    if city:
        event["city"] = city
    if location and not city:
        event["location"] = location
    return event


# --------------------------------------------------------------------------- mlh
# Set by pull_mlh once it knows which season actually has events.
MLH_SOURCE_URL = ["https://www.mlh.com/seasons/events"]


def from_mlh(row):
    starts, ends = iso(row.get("startsAt")), iso(row.get("endsAt"))
    if not starts or not ends:
        return None
    venue = row.get("venueAddress") or {}
    location_text = row.get("location") or ", ".join(
        x for x in (venue.get("city"), venue.get("state"), venue.get("country")) if x)
    scope, city = place(location_text)
    mode = "online" if (row.get("formatType") or "").lower() in ("digital", "hybrid") else "in-person"
    if mode == "online":
        city, scope, location_text = None, "global", None
    elif not city:
        # An in-person event outside the filter's India-first city list still has to say
        # where it is, or the card reads as a global online event held nowhere.
        scope = "global"
    url = row.get("websiteUrl") or f"https://www.mlh.com{row.get('url', '')}"
    event = {
        "id": f"{slugify(clean_title(row.get('name')))}-{starts[:7]}",
        "name": clean_title(row.get("name")),
        "organiser": {"name": "Major League Hacking", "type": "community"},
        "scope": scope,
        "mode": mode,
        "themes": map_themes([row.get("name", "")]),
        "starts": starts,
        "ends": ends,
        "registration_closes": None,
        "prize": None,  # MLH does not publish prize pools on the season listing
        "team": {"min": 1, "max": 4},
        "eligibility": "students",  # MLH member events are student hackathons by definition
        "location": location_text or None,
        "url": url,
        "source": "mlh",
        "source_url": MLH_SOURCE_URL[0],
        "first_seen": TODAY.isoformat(),
        "last_seen": TODAY.isoformat(),
        "locked": False,
    }
    if city:
        event["city"] = city
    return event


# --------------------------------------------------------------------------- seeds
def pull_devpost():
    rows = []
    for page in range(1, 7):
        try:
            payload = json.loads(fetch(f"https://devpost.com/api/hackathons?status[]=open&page={page}"))
        except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as exc:
            log(f"  devpost page {page}: {exc} -- skipped")
            continue
        rows += payload.get("hackathons", [])
        time.sleep(1)  # one request at a time; we are a guest here
    return rows, from_devpost


def pull_unstop():
    rows = []
    for page in range(1, 6):
        url = ("https://unstop.com/api/public/opportunity/search-result"
               f"?opportunity=hackathons&page={page}&per_page=30&oppstatus=open")
        try:
            payload = json.loads(fetch(url))
        except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as exc:
            log(f"  unstop page {page}: {exc} -- skipped")
            continue
        rows += (payload.get("data") or {}).get("data", [])
        time.sleep(1)
    return rows, from_unstop


def mlh_season(today=None):
    """MLH names a season for the year it ends in, and it rolls over mid-year. Hardcoding
    2026 returned 253 past events and nothing upcoming, which is a silent, total failure --
    the run stays green and the source just contributes nothing."""
    today = today or TODAY
    return today.year + 1 if today.month >= 7 else today.year


def pull_mlh():
    seasons = [mlh_season(), mlh_season() - 1]
    for season in seasons:
        url = f"https://www.mlh.com/seasons/{season}/events"
        try:
            html = fetch(url)
            blob = re.search(r'<script[^>]*application/json[^>]*>(.*?)</script>', html, re.S).group(1)
            payload = json.loads(blob)
        except (urllib.error.URLError, AttributeError, json.JSONDecodeError, TimeoutError) as exc:
            log(f"  mlh season {season}: {exc} -- skipped")
            continue
        rows = [r for r in (payload.get("props") or {}).get("upcomingEvents") or []
                if isinstance(r, dict) and r.get("startsAt")]
        if rows:
            log(f"  mlh: season {season}")
            MLH_SOURCE_URL[0] = url
            return rows, from_mlh
        log(f"  mlh season {season}: no upcoming events, trying the previous season")
    return [], from_mlh


SEEDS = {"devpost": pull_devpost, "unstop": pull_unstop, "mlh": pull_mlh}


def richness(event):
    """How much a row actually tells you. Used to pick a winner when two sources collide."""
    score = 0
    if event.get("registration_closes"):
        score += 3
    if event.get("prize"):
        score += 2
    if event.get("city"):
        score += 2
    if (event.get("team") or {}).get("max"):
        score += 1
    if event.get("themes") != ["other"]:
        score += 1
    return score


def main(argv):
    dry_run = "--dry-run" in argv

    collected, dropped = [], 0
    for name, puller in SEEDS.items():
        log(f"fetching {name}...")
        try:
            raw_rows, mapper = puller()
        except Exception as exc:  # a seed must never take the run down
            log(f"  {name}: {exc} -- skipped entirely")
            continue
        mapped = 0
        for raw in raw_rows:
            try:
                event = mapper(raw)
            except Exception as exc:
                log(f"  {name}: row failed mapping ({exc})")
                event = None
            if not event:
                dropped += 1
                continue
            errors = validate_row(event)
            if errors:
                dropped += 1
                log(f"  {name}: dropped {event.get('name', '?')!r} -- {errors[0]}")
                continue
            collected.append(event)
            mapped += 1
        log(f"  {name}: {mapped} valid of {len(raw_rows)} raw")

    # Dedupe across sources, keeping both URLs.
    merged = {}
    for event in collected:
        key = norm_key(event["name"], anchor(event))
        if key not in merged:
            merged[key] = event
            continue
        keep, drop = merged[key], event
        if richness(drop) > richness(keep):
            keep, drop = drop, keep
        links = keep.get("also_seen_at", []) + [drop["url"]]
        keep["also_seen_at"] = sorted({l for l in links if l != keep["url"]})[:6]
        merged[key] = keep
    events = sorted(merged.values(), key=lambda e: (anchor(e), e["name"]))
    log(f"\n{len(collected)} rows -> {len(events)} after dedupe, {dropped} dropped")
    with_dates = sum(1 for e in events if e.get("starts"))
    log(f"{with_dates} have published run dates, {len(events) - with_dates} are deadline-only")

    # Respect hand-corrected rows.
    existing = {}
    if DATA.exists():
        for row in json.loads(DATA.read_text()).get("events", []):
            existing[row["id"]] = row
    kept_locked = 0
    for index, event in enumerate(events):
        previous = existing.get(event["id"])
        if previous and previous.get("locked"):
            events[index] = {**previous, "last_seen": TODAY.isoformat()}
            kept_locked += 1
        elif previous:
            events[index]["first_seen"] = previous.get("first_seen", event["first_seen"])
    if kept_locked:
        log(f"{kept_locked} hand-locked rows preserved")

    cutoff = TODAY - timedelta(days=1)
    live = [e for e in events if last_relevant_day(e) >= cutoff.isoformat()]
    past = [e for e in events if last_relevant_day(e) < cutoff.isoformat()]
    log(f"{len(live)} live, {len(past)} already ended -> archive")

    if dry_run:
        log("\n--dry-run: nothing written")
        return 0

    DATA.write_text(json.dumps({
        "last_updated": datetime.now().astimezone().isoformat(timespec="seconds"),
        "note": "Real, verified events only. Every row keeps a source_url.",
        "events": live,
    }, indent=2) + "\n")

    archive = json.loads(ARCHIVE.read_text()).get("events", []) if ARCHIVE.exists() else []
    seen = {e["id"] for e in archive}
    archive += [e for e in past if e["id"] not in seen]
    ARCHIVE.write_text(json.dumps({
        "last_updated": datetime.now().astimezone().isoformat(timespec="seconds"),
        "note": "Events whose end date has passed. They move here rather than vanishing.",
        "events": sorted(archive, key=anchor),
    }, indent=2) + "\n")

    log(f"\nwrote {len(live)} events to data/hackathons.json")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
