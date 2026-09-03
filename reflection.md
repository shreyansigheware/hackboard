# Reflection — Monthly hackathon dashboard

**Issue:** [ai-learning-plan#5](https://github.com/shreyansigheware/ai-learning-plan/issues/5)
· **Pillar:** Knowledge + Economic

## The artifact

| | |
|---|---|
| Repo | https://github.com/shreyansigheware/hackboard |
| Live URL | *deploying* — https://shreyansigheware.github.io/hackboard/ |
| Real verified events | **238**, from Devpost, Unstop and MLH |
| Sessions done | 1–4, and part of 5 |

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
- **Mapped JSON fields instead of using a model to extract.** The issue recommends handing page
  text to `claude-haiku-4-5` because CSS selectors rot. Three of the five seeds turned out to
  publish structured JSON, where field mapping is deterministic, free and cannot invent a date.
  The model path is still right for Devfolio, which renders client-side and ships no listings.
- **Unknown run dates are stored as null, not filled in.** Unstop's listing API has
  `start_date: null` on every row and an `end_date` that mirrors the registration deadline. The
  first pass wrote those into the event dates and produced a hackathon that appeared to run for
  seven months. The schema now allows null run dates and requires every row to anchor to a
  month by *some* route — run dates or a deadline.
- **Prizes keep their own currency.** `prize_inr` assumed one currency; Devpost pays in USD.
  Converting at a made-up rate would invent a precision and a date the source never gave.

## Blockers

- **Lighthouse has not been run**, so LCP and CLS have no number. Needs the deployed URL.
- **The frame-rate numbers are weak.** Headless Chrome with `--disable-gpu` and a scripted
  scroll is not a finger on a phone. The 60fps target is not claimed as passed.
- **The daily workflow has run green once, on manual dispatch**, and committed a real change
  (247 events). #5 wants two green runs, so one scheduled run still has to land.
- **Devfolio contributes nothing** — it is client-rendered and needs the model-extraction path.

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
- **Hardcoded the MLH season year.** `seasons/2026/events` returned 253 past events and zero
  upcoming, because MLH rolls the season over mid-year and it was already September. The run
  stayed green and the source silently contributed nothing — the worst kind of failure. The
  season is now computed at run time, with a fallback to the previous one.
- **Wrote registration dates into event dates.** Covered above; it produced a seven-month
  hackathon, and it was only visible because a card on screen looked wrong. Reading the raw
  API response instead of assuming the field names meant what they sounded like would have
  caught it before any data was written.
- **Two bad measurements reported before a good one.** First called a horizontal-overflow bug
  that did not exist (headless Chrome clamps to 500px on macOS, so the "375px" shot was a
  cropped 500px render). Then reported a filter latency of 0.0 ms, five times running, from a
  MutationObserver that fired on the first unrelated mutation. A measurement that comes back
  suspiciously perfect is a broken measurement, and both times the tell was there to read.
- **Built a refresh job that would have quietly stopped republishing the site.** The workflow
  fetched, validated and committed 247 events correctly — and no deploy ran. A push made with
  `GITHUB_TOKEN` does not trigger workflows, by design, so the data would have kept updating
  in the repo while the live site stayed frozen on day one. Exactly the "stale data is worse
  than no dashboard" failure the issue names, and it was only caught by checking whether the
  deploy actually fired rather than trusting the green tick on the refresh.
- **Broke the deploy by putting icon generation in the build.** `prebuild` shelled out to
  Chrome at `/Applications/Google Chrome.app/...`, which exists on this Mac and on no CI
  runner. It worked locally and failed on the first push. The icons are committed artifacts;
  regenerating them is a manual step now.
- **Rendered an icon that was a broken-image marker.** The renderer pointed an `<img>` at a
  local `file://` SVG, which headless Chrome refuses to load from a local page. It produced a
  512×512 PNG of the right size, right background colour, and no icon — which would have passed
  any check that only looked at dimensions. Looking at the image is what caught it.
- **Shipped a URL bug that the test harness exposed.** The filter effect rebuilt the query
  string from scratch, silently dropping any parameter it did not manage. It surfaced because
  `?novirtual=1` kept turning itself off mid-measurement — but the same bug would have eaten
  a UTM tag or any other param on a shared link.

## #6 — the PWA layer

Built on top of the same repo, per the issue: manifest, maskable icons, service worker,
install flows for both platforms, offline state.

**The course does not match the constraint.** It teaches Expo/React Native, Supabase and
app-store submission — reported on the issue before planning anything, and not followed.

**What `navigator.onLine` taught me.** The offline badge did not appear when the network was
cut, and the first instinct was that the test harness was wrong. It was — DevTools network
emulation does not flip that flag — but chasing it surfaced that `navigator.onLine` is
unreliable in production too: it reports true behind a captive portal. The badge is now driven
by an actual request. A broken test found a real bug.

**Verified rather than asserted.** `scripts/check-pwa.mjs` drives a real browser: worker
activated in the `/hackboard/` scope, manifest parsed with zero errors, and a reload with the
network cut rendering 181 cards from cache. Run against the live HTTPS site, not just
localhost.

**Not done:** Web Push (iOS needs 16.4+, installed, and a user gesture, so the install has to
come first), `apple-touch-startup-image` splash screens, and — the one that matters — **it has
not been installed on a real iPhone or a real Android phone.** That is the definition of done
here, and headless Chrome cannot stand in for it.

## The three questions

> Answer these yourself — they're the part that compounds, and they're about your session, not the code.

### What worked?

<!-- your answer -->

### What would I skip next time?

<!-- your answer -->

### What would I do differently?

<!-- your answer -->
