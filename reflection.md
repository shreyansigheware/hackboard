# Reflection — Monthly hackathon dashboard

**Issue:** [ai-learning-plan#5](https://github.com/shreyansigheware/ai-learning-plan/issues/5)
· **Pillar:** Knowledge + Economic

## The artifact

| | |
|---|---|
| Repo | https://github.com/shreyansigheware/hackboard |
| Live URL | **not deployed yet** |
| Real verified events | **0** — schema and tooling ready, curation outstanding |
| Sessions done | 1 of 5 (scaffolding only) |

## Decisions, and why

- **Name: `hackboard`.** Picked over `hackathon-radar` and `hackathons-this-month` for being
  the shortest thing that still sounds like a product out loud. Not renaming it — the URL is
  going in the Upwork portfolio.
- **Month rule: run dates overlap the month, *or* registration closes in it.** Written up in
  the README. The visitor's real question is what they can still act on this month, so a
  October event closing in September has to appear in September.
- **Data tooling in Python, not Node.** Discovered mid-session that this machine has no Node
  and no Homebrew — stock `python3` 3.9 only. Rather than stopping to install a toolchain,
  session 1 was written dependency-free against Python, which also means the daily Action will
  need no JS runtime. The frontend stack decision is deferred to session 2, where the issue
  puts it.
- **Hand-rolled validator instead of a JSON Schema library.** Same reason — no package manager
  in the loop yet. It covers the schema subset actually used, plus the cross-field date rules
  JSON Schema can't express, which are the errors an extraction model actually makes.

## Blockers

- **No Node on this machine.** Has to be resolved before a Vite/React frontend. Same install
  pattern as `gh` (tarball into `~/.local/bin`), or commit to the vanilla path the issue allows.
- **No real data yet.** The 40–60 verified rows need live checking against Devfolio, Unstop,
  Devpost, MLH and HackerEarth. Accuracy beats volume here, so this is a deliberate block of
  work rather than something to guess at.

## Where Claude got it wrong

> The issue calls this the most valuable output of the build. Kept honestly, including the
> small ones.

- **Measured a horizontal-overflow bug that didn't exist.** Screenshotted the design sketch at
  `--window-size=375` and read the cropped result as the mobile layout breaking. Headless Chrome
  on macOS clamps the window to 500px wide, so it was a 500px render cropped to 375. Re-tested
  through a 375px iframe: the layout was fine all along.
- **Shipped a CSS cascade bug into the sketch.** Declared `.sheet-btn { display: none }` *after*
  the `@media (max-width: 860px)` block that sets `display: flex`, so the mobile filter button
  could never appear. Same specificity, later rule wins. Caught on the second render.
- **Wrote a validator that passed `"2026-13-45"`.** The schema's `^\d{4}-\d{2}-\d{2}$` pattern
  only proves the shape, and the real-date check was only applied to three of the five date
  fields. Caught by deliberately feeding it a bad row rather than by reading the code — which
  is the lesson: the negative test found in one run what re-reading would not have.

## The three questions

> Answer these yourself — they're the part that compounds, and they're about your session, not the code.

### What worked?

<!-- your answer -->

### What would I skip next time?

<!-- your answer -->

### What would I do differently?

<!-- your answer -->
