# hackboard

**Every hackathon happening this month, filterable down to the ones you could actually enter.**

Today that means checking Devfolio, then Unstop, then HackerEarth, then Devpost, then MLH, then
a WhatsApp group, and still missing half of them. There is no single monthly view. This is that
view.

> **Status: sessions 1–4 done, session 5 partly.** The dashboard is built and filtering 238
> real events from three sources. Performance is measured at 1,000 rows. The daily refresh
> workflow is written but has not run on a schedule yet.

Built as module [#5](https://github.com/shreyansigheware/ai-learning-plan/issues/5) of a
[learning plan run in public](https://github.com/shreyansigheware/ai-learning-plan).

---

## The month rule

A hackathon running 28 Aug → 3 Sep is in both months. One whose registration closes in August
but which runs in October is arguably an August item. There is no correct answer here, only a
documented one. This is the documented one:

> **An event appears in month M if either its run dates overlap M, or its registration
> deadline falls in M.**

So:

| Event | Appears in |
|---|---|
| Runs 5–7 Sep, registration closed 20 Aug | August *and* September |
| Runs 28 Aug – 3 Sep | August *and* September |
| Runs 10–12 Oct, registration closes 25 Sep | September *and* October |
| Runs 10–12 Oct, no stated deadline | October only |

**Why deadline-inclusive rather than run-dates-only:** the visitor's real question is not "what
is happening in September", it is "what can I still act on in September". An event that runs in
October but closes for entry this month is something you must do something about *now*; leaving
it out of September is the failure mode that makes the whole dashboard useless. The cost is that
some events appear twice, which is the cheaper error.

An event never appears in a month purely because it was announced in it.

---

## Design decisions

"Modern" is not a style, it is a set of decisions. These are the ones made, in
`design/sketch.html`, before any component existed.

**One typeface: IBM Plex Sans, two weights (400/600).** Chosen over Inter because this view is
mostly dates, prize figures and counts — Plex has proper tabular numerals, so a column of
₹ amounts and a live result count don't shift as they change. `font-variant-numeric: tabular-nums`
is set globally for that reason.

**Five colours carry the layout** — background, surface, text, muted text, one accent blue.
Three semantic colours sit on top (`--urgent`, `--soon`, `--open`) and are used *only* for
deadline state. The moment red means something else too, it stops meaning "closing soon".

**Dark by default, following the system setting** — not a toggle nobody finds. Light is defined
on bare `:root`, dark overrides tokens under `prefers-color-scheme: dark`, and an explicit
`[data-theme]` wins over both so a future toggle works in both directions.

**Deadline urgency reads without reading.** A card closing in two days gets a coloured left
edge, a filled dot and a colour — three signals, not one, so it survives a red-green colour
vision deficiency and a greyscale screenshot. "Closes in 2 days" and "closes in 3 weeks" must
not look alike at a glance.

**Spacing on a 4px grid**, exposed as `--s1`…`--s7`. Inconsistent spacing is the single most
common thing that makes a project look like a student project.

**Card density is deliberate.** Name, organiser, dates, mode, location, prize, team size,
themes, eligibility, deadline and a link — and it still has to be scannable, so anything the
visitor doesn't *decide* on was cut.

**Motion is restrained.** 160ms ease-out on card hover only, wrapped in
`prefers-reduced-motion: reduce`.

**Layout:** desktop gets a persistent filter rail plus a results grid; mobile gets a sticky
filter button opening a sheet. Two layouts, not one squashed one.

**The zero-result state suggests a fix** — "The closest thing is 6 events if you drop *Women
only*", with a button that drops it. Not a sad face.

---

## Performance targets

Measured at **1,000 items**, not 40 — `data/stress-test.json` exists for exactly that, and
`?stress=1` drops the month frame so all 1,000 render at once.

`?novirtual=1` renders every card instead of only the visible window, so *before* and *after*
are the same page measured against itself rather than against a guess.

Numbers from `node scripts/measure.mjs`, which drives headless Chrome over the DevTools
Protocol. Median of 7 filter runs; frame intervals sampled across a full scroll of the list.

| Measure | Before (no windowing) | After (windowed) | Target |
|---|---|---|---|
| Cards in the DOM at 1,000 rows | 1,000 | **16** | flat as items grow ✅ |
| Total DOM nodes | 18,704 | **466** | — |
| DOM nodes after scrolling to the middle | 18,704 | **461** | flat ✅ |
| Filter/search response, median | 34.3 ms | **15.4 ms** | under 100 ms ✅ |
| Filter/search response, worst of 7 | 44.4 ms | **18.1 ms** | under 100 ms ✅ |
| Frame interval during scroll, p95 | 67.2 ms | **20.0 ms** | 16.7 ms = 60fps ⚠️ |

**Reading these honestly:**

- **The DOM node count is the real result.** 18,704 nodes down to 466, and flat after
  scrolling. That is what windowing buys, and it is the number that keeps holding as the
  dataset grows.
- **The filter was never the bottleneck.** Both figures are already well inside the 100 ms
  target; filtering 1,000 rows is a cheap array pass either way. The 34 ms → 15 ms difference
  is React reconciling 1,000 cards, not the filter itself.
- **The frame numbers are the weakest evidence here** and are not claimed as a pass. They come
  from headless Chrome with `--disable-gpu` and a scripted scroll, which is not a finger on a
  phone. p95 improving from 67 ms to 20 ms is a real signal about the direction; "holds 60fps"
  is not yet proven and needs a Performance-panel recording on a real device.
- **LCP and CLS are not measured yet.** Lighthouse against the deployed URL is outstanding.

---

## Data

Three files, all validated against `schema/hackathon.schema.json`:

| File | What |
|---|---|
| `data/hackathons.json` | Real, verified events. Every row has a working `source_url`. |
| `data/archive.json` | Events whose end date has passed. They move, they don't vanish. |
| `data/stress-test.json` | 1,000 synthetic rows. Generated, marked, never served as real. |

The validator rejects a row marked `"synthetic": true` in the real file, so the two cannot be
confused by accident.

Rows carrying `"locked": true` were corrected by hand and the merge step must not overwrite
them.

### Running the tools

Dependency-free, stock `python3` — no install step locally or on the runner.

```bash
python3 scripts/generate_stress_test.py            # writes data/stress-test.json (1,000 rows)
python3 scripts/generate_stress_test.py 5000       # a different size
python3 scripts/validate.py data/hackathons.json   # exit 1 if any row fails
python3 scripts/validate.py data/stress-test.json --allow-synthetic
```

The generator is deterministic — same seed, same file — so a performance comparison between two
commits measures the code and not a different dataset. It learns its distributions from
`data/hackathons.json` once that has 20+ real rows, so the stress set clusters the way the real
one does rather than being uniformly random.

The validator covers what JSON Schema can express plus the cross-field rules it can't: `ends`
after `starts`, `registration_closes` not after `starts`, `last_seen` not before `first_seen`,
and dates that match the pattern but aren't real (`2026-13-45`).

---

## Where the data comes from

`seeds.yml` lists the sources. Three of the five turned out to publish structured JSON, so
those are mapped field by field:

| Source | How | What it gives | What it doesn't |
|---|---|---|---|
| **Devpost** | public JSON API | global events, run dates, prizes in USD | no separate registration deadline |
| **Unstop** | public JSON API | India-heavy, real registration deadlines, prizes in INR, team sizes, venue city | **no run dates at all** — `start_date` is null on every row |
| **MLH** | JSON payload embedded in the page | student hackathons worldwide, run dates, venues | no prizes, no deadlines |
| **Devfolio** | *not enabled* | — | client-rendered; its HTML contains no listings |
| **HackerEarth** | *not enabled* | — | not inspected yet |

**Mapping fields beats asking a model, where a feed exists.** The issue suggests handing page
text to `claude-haiku-4-5` because hand-written CSS selectors rot. That reasoning holds for
HTML; it does not apply to a documented JSON endpoint, where field mapping is deterministic,
free, and cannot hallucinate a date. The model-extraction path is still the right answer for
Devfolio and anything else without a feed, and is not built yet.

**"Scans the internet" honestly means the seed list plus one hop from it.** Right now it is not
even that — it is the seed list, no hop. A real search step is a stretch goal, not a claim to
make before it exists.

### The daily refresh

`.github/workflows/refresh.yml` runs `scripts/fetch_sources.py` at 01:30 UTC (07:00 IST): fetch
each seed, normalise, validate, dedupe across sources, merge without clobbering locked rows,
move finished events to the archive, and commit only if something changed. A failing seed is
logged and skipped — one bad source must never fail the run or wipe good data.

`last_updated` is shown in the footer of the site. If the job breaks silently for a week, a
visitor can see that, and so can I.

Known and deliberate: `data/hackathons.json` is committed rather than generated at build time,
so the site is always serving something even if every source is down.

---

## Stack

**Vite + React + TypeScript, with [TanStack Virtual](https://tanstack.com/virtual) for
windowing**, deployed to GitHub Pages by a workflow. The virtualiser is the part not worth
hand-rolling first time, and TypeScript caught several data-shape mistakes before they
rendered.

**The data tooling is Python and stays Python.** The machine this started on had no Node and no
Homebrew, so session 1 was written against stock `python3` — and that turned out to be the
better split anyway: the daily refresh needs no JS toolchain on the runner, and the frontend
never touches the ingest code. Node 24 was installed later, for the frontend only.

### Running it

```bash
npm install
npm run dev      # copies data/ into public/ and starts Vite
npm run build    # typecheck + production build into dist/
node scripts/measure.mjs http://localhost:4173/hackboard/   # performance numbers
```

Query parameters, all measurement-only and not reachable from the UI:
`?stress=1` loads the 1,000-row fixture and drops the month frame · `?novirtual=1` renders
every card · `?month=all` shows every month at once.

---

## Sessions

| # | ~Hrs | What | Status |
|---|---|---|---|
| 1 | 3 | Repo, `CLAUDE.md`, schema, real rows, 1,000-row generator, design sketch | **done** — 238 real events, not 40 |
| 2 | 4 | Layout, cards, month selector | **done** |
| 3 | 4 | Filters, URL state, search, empty + loading states | **done** |
| 4 | 3 | Virtualisation, measurement, mobile pass, Pages deploy, README | **done** except Lighthouse |
| 5 | 4 | Seeds, fetch + extract + merge, the scheduled workflow, `last_updated`, reflection | workflow written, **not yet run on schedule** |

### Outstanding

- Lighthouse on the deployed URL: LCP and CLS are the two targets with no number against them.
- A Performance-panel recording on a real phone, to replace the weak headless frame numbers.
- The daily workflow has to actually run green twice and commit one real change before #5 closes.
- Devfolio needs the model-extraction path; HackerEarth has not been inspected.
- Keyboard and screen-reader pass beyond `/` to focus search and `Esc` to close the sheet.

Not done when it works on a laptop. Done when someone else opens the link on their phone and
finds a hackathon.
