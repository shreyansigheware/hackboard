# hackboard

A dashboard listing every hackathon happening in a given month, filterable down to the ones a
visitor could actually enter, kept current by a daily GitHub Action.

Tracked by [ai-learning-plan#5](https://github.com/shreyansigheware/ai-learning-plan/issues/5).
That issue is the spec — read it before proposing anything structural. Close it with a comment
linking this repo and the live URL; the work happens here.

## Who this is for

Not the author. Assume the visitor is on a phone, on mobile data, and impatient. They must be
able to answer in under ten seconds: what's on this month, what's on in my city, what's online,
what closes this week.

## Non-negotiables

These come from the issue and are not up for renegotiation mid-build:

- **The month is the frame.** Month-scoped view with a selector, not infinite scroll.
- **Filters combine** — AND across categories, OR within a category.
- **Filter state lives in the URL.** A filtered view is shareable and the back button works.
- **Performance is measured at 1,000 rows, not 40.** See the targets table in the README.
  "It feels fast" is not a result; numbers before and after go in the README.
- **Accuracy beats volume.** Every row keeps a `source_url`. Listing a hackathon that closed
  last week is worse than listing 30 correct ones.
- **No secrets in the repo.** `ANTHROPIC_API_KEY` is a GitHub Actions secret. Check before a
  push, not after.
- **375px wide must work** — no horizontal scroll, no squashed filter rail.

## The rule for this module

If the author can't explain what a file does and why it's there, it doesn't ship. Delete it or
explain it. When you add a file, say in one line what it is for.

## How to work in this repo

- **Plan before code.** Propose the approach and expect to be argued with before building.
- **One concern per turn.** "Add the city filter, wire it to the URL param, update the result
  count" — not "build the dashboard."
- **Commit small and often**, with a message saying why, so a bad turn costs ten minutes.
- **Every diff gets read** by the author. Keep them reviewable.
- **Measure, don't assert.** Any performance claim needs a number next to it.
- When you get something confidently wrong and it's caught, it goes in `reflection.md`. That
  list is a deliverable, not an embarrassment.

## Data rules

- `data/hackathons.json` is the real, verified set. Every row needs a working `source_url`.
- `data/stress-test.json` is synthetic, generated, and never shipped as real data. Rows in it
  are named so they can't be mistaken for real events.
- `data/archive.json` holds past events. Events age out of the live set; they don't vanish.
- Rows with `"locked": true` were corrected by hand. The merge step must not overwrite them.
- Every row is validated against `schema/hackathon.schema.json` before it is written. A row
  that fails validation is dropped and logged, never merged.

## Stack

Not chosen yet — decided at the start of session 2 and recorded in `reflection.md` with one
line on why. Session 1 is deliberately dependency-free: plain Node scripts, no build step.

Candidates from the issue: Vite + React + TypeScript + TanStack Virtual (recommended), or
vanilla HTML/CSS/JS with a hand-rolled virtual scroller if the performance bar still holds.
