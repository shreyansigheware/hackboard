# hackboard

**Every hackathon happening this month, filterable down to the ones you could actually enter.**

Today that means checking Devfolio, then Unstop, then HackerEarth, then Devpost, then MLH, then
a WhatsApp group, and still missing half of them. There is no single monthly view. This is that
view.

> **Status: session 1 of 5.** Schema, validator, stress-test generator and design sketch are in.
> No dashboard yet, no real data yet, no refresh job yet. Nothing here is live.

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

Measured at **1,000 items**, not 40. `data/stress-test.json` exists for exactly this.

| Target | How it gets checked | Before | After |
|---|---|---|---|
| Scroll holds 60fps | DevTools → Performance, count dropped frames | — | — |
| Filter/search under 100ms | `performance.now()` around the filter | — | — |
| LCP under 1.5s on throttled 4G | Lighthouse, mobile preset | — | — |
| No layout shift (CLS ≈ 0) | Lighthouse | — | — |
| DOM node count flat as items grow | DevTools → Performance monitor | — | — |

The before/after columns get filled with real numbers as the work happens. "It feels fast" is
not a result.

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

## The daily refresh

*Not built yet — session 5.* A scheduled GitHub Action will read `seeds.yml`, fetch each listing
plus one hop to linked event pages, extract structured rows with `claude-haiku-4-5` against the
schema above, validate, merge without clobbering locked rows, age past events into the archive,
and commit only if something changed.

Two things worth stating plainly now:

- **"Scans the internet" honestly means the seed list plus one hop from it.** A real search step
  is a stretch goal, not a claim to make before it exists.
- **`last_updated` will be visible in the UI.** If the job has been silently broken for a week,
  a visitor should be able to see that — and so should I.

---

## Stack

Not chosen yet; decided at the start of session 2 and recorded in `reflection.md` with the
reasoning. Session 1 is deliberately dependency-free.

Worth knowing: **there is no Node on the machine this was started on** — stock macOS `python3`
only, and no Homebrew. That is why the data tooling is Python, which also means the daily Action
needs no JS toolchain. It does need resolving before a Vite/React frontend can be built.

---

## Sessions

| # | ~Hrs | What | Status |
|---|---|---|---|
| 1 | 3 | Repo, `CLAUDE.md`, schema, 40 real rows, 1,000-row generator, design sketch | scaffolding done; **real rows outstanding** |
| 2 | 4 | Layout, cards, month selector — static, no filtering | |
| 3 | 4 | Filters, URL state, search, empty + loading states | |
| 4 | 3 | Virtualisation, measurement, mobile pass, Pages deploy, README | |
| 5 | 4 | Seeds, fetch + extract + merge, the scheduled workflow, `last_updated`, reflection | |

Not done when it works on a laptop. Done when someone else opens the link on their phone and
finds a hackathon.
