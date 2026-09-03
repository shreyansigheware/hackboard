import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Dataset, Hackathon } from "./types";
import {
  addMonths, daysUntil, formatMonth, formatPrize, formatRun, formatTeam, loadDataset, monthKey,
  sortKey,
} from "./data";
import {
  activeChips, applyFilters, bestRelaxation, EMPTY, fromSearchParams, optionCounts,
  toSearchParams, type FilterState,
} from "./filters";

const LABELS: Record<string, Record<string, string>> = {
  scope: { global: "Global", india: "India", city: "City-specific" },
  mode: { online: "Online", "in-person": "In-person", hybrid: "Hybrid" },
  org: { company: "Company", university: "University", community: "Community", government: "Government" },
  theme: {
    ai: "AI/ML", web3: "Web3", fintech: "FinTech", healthtech: "HealthTech",
    cybersecurity: "Cybersecurity", "open-source": "Open Source",
    sustainability: "Sustainability", hardware: "Hardware", other: "Other",
  },
  eligibility: { open: "Open to all", students: "Students only", women: "Women only", freshers: "Freshers" },
  timing: { open: "Registration open", "closes-week": "Closes this week", "starts-week": "Starts this week" },
};

const label = (group: string, value: string) => LABELS[group]?.[value] ?? value;

function urgency(days: number | null) {
  if (days === null) return { cls: "d-none", text: "Deadline not published" };
  if (days < 0) return { cls: "d-urgent", text: "Registration closed" };
  if (days === 0) return { cls: "d-urgent", text: "Closes today" };
  if (days <= 3) return { cls: "d-urgent", text: `Closes in ${days} day${days === 1 ? "" : "s"}` };
  if (days <= 14) return { cls: "d-soon", text: `Closes in ${days} days` };
  return { cls: "d-open", text: `Closes in ${Math.round(days / 7)} weeks` };
}

function Card({ event, today }: { event: Hackathon; today: Date }) {
  const days = event.registration_closes ? daysUntil(event.registration_closes, today) : null;
  const state = urgency(days);
  const prize = formatPrize(event.prize);
  const where = event.city ?? event.location ?? (event.scope === "india" ? "India" : "Global");
  return (
    <article className={`card${days !== null && days >= 0 && days <= 3 ? " urgent" : ""}`}>
      <div>
        <h2><a className="title" href={event.url} target="_blank" rel="noopener noreferrer">{event.name}</a></h2>
        <div className="org">{event.organiser.name} · {label("org", event.organiser.type)}</div>
      </div>
      <div className="meta">
        <span><b>{formatRun(event)}</b></span>
        <span>{where} · {label("mode", event.mode)}</span>
        {prize && <span className={event.prize?.amount ? "money" : ""}>{prize}</span>}
        <span>{formatTeam(event.team)}</span>
      </div>
      <div className="tags">
        {event.themes.map((t) => <span className="tag" key={t}>{label("theme", t)}</span>)}
        <span className="tag">{label("eligibility", event.eligibility)}</span>
      </div>
      <div className="foot">
        <span className={`deadline ${state.cls}`}>{state.text}</span>
        <a className="go" href={event.url} target="_blank" rel="noopener noreferrer">
          Open<span aria-hidden="true"> →</span>
        </a>
      </div>
    </article>
  );
}

function Group({
  group, values, counts, selected, onToggle,
}: {
  group: string; values: string[]; counts: Record<string, number>;
  selected: string[]; onToggle: (value: string) => void;
}) {
  if (values.length === 0) return null;
  return (
    <fieldset className="group">
      <legend>{group === "org" ? "Organiser" : group === "q" ? "Search" : group}</legend>
      {values.map((value) => {
        const count = counts[value] ?? 0;
        const checked = selected.includes(value);
        return (
          <label className={`opt${count === 0 && !checked ? " zero" : ""}`} key={value}>
            <input type="checkbox" checked={checked} disabled={count === 0 && !checked}
                   onChange={() => onToggle(value)} />
            <span>{label(group, value)}</span>
            <span className="n">{count}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

export default function App() {
  const today = useMemo(() => new Date(), []);
  const thisMonth = monthKey(today.toISOString());
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Read once from the URL the page was opened with: these are set by the measurement
  // harness, and re-reading them on every render made them flip to false the moment the
  // filter effect rewrote the query string.
  const [{ stress, noVirtual }] = useState(() => {
    const params = new URLSearchParams(location.search);
    return {
      stress: params.get("stress") === "1",
      // Measurement mode: renders every card instead of only the visible window, so the
      // before/after numbers in the README compare the page against itself, not a guess.
      noVirtual: params.get("novirtual") === "1",
    };
  });
  const [state, setState] = useState<FilterState>(() =>
    fromSearchParams(location.search, stress ? "all" : thisMonth));
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadDataset(stress).then(setData).catch((e: Error) => setError(e.message));
  }, [stress]);

  // The URL is the source of truth for a shareable view, so every change is pushed to it and
  // the back button restores the previous set of filters.
  useEffect(() => {
    const query = toSearchParams(state, location.search);
    if (query !== location.search.replace(/^\?/, "")) {
      history.pushState(null, "", `${location.pathname}?${query}`);
    }
  }, [state]);

  useEffect(() => {
    const onPop = () => setState(fromSearchParams(location.search, stress ? "all" : thisMonth));
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [thisMonth, stress]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheetOpen(false);
      const typing = document.activeElement instanceof HTMLInputElement;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const events = data?.events ?? [];
  // "37 of 214 this month" -- the denominator is the month with every other filter dropped.
  const monthEvents = useMemo(
    () => applyFilters(events, { ...EMPTY, month: state.month }, today),
    [events, state.month, today],
  );
  const results = useMemo(
    () => applyFilters(events, state, today).sort((a, b) => sortKey(a, today) - sortKey(b, today)),
    [events, state, today],
  );
  const counts = useMemo(() => optionCounts(events, state, today), [events, state, today]);
  const relax = useMemo(
    () => (results.length === 0 ? bestRelaxation(events, state, today) : null),
    [events, state, today, results.length],
  );

  const cities = useMemo(() => {
    const tally = new Map<string, number>();
    for (const event of events) if (event.city) tally.set(event.city, (tally.get(event.city) ?? 0) + 1);
    return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
  }, [events]);

  const toggle = useCallback((key: keyof FilterState, value: string) => {
    setState((prev) => {
      const current = prev[key] as string[];
      return {
        ...prev,
        [key]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
      };
    });
  }, []);

  const drop = useCallback((chip: { key: string; value?: string }) => {
    setState((prev) => {
      if (chip.key === "prize") return { ...prev, prize: false };
      if (chip.key === "solo") return { ...prev, solo: false };
      if (chip.key === "q") return { ...prev, q: "" };
      const current = prev[chip.key as keyof FilterState] as string[];
      return { ...prev, [chip.key]: current.filter((v) => v !== chip.value) };
    });
  }, []);

  // Windowing: only the rows on screen are in the DOM, which is what keeps the node count
  // flat as the dataset grows. Rows, not cards, so the responsive grid still works.
  const [columns, setColumns] = useState(1);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => setColumns(Math.max(1, Math.floor(element.clientWidth / 340)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [data]);

  const rowCount = Math.ceil(results.length / columns);
  const virtualiser = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 232,
    overscan: 4,
    gap: 12,
  });

  const chips = activeChips(state);

  return (
    <>
      <header className="top">
        <div className="wordmark">hack<span>board</span></div>
        <nav className="month" aria-label="Month">
          <button onClick={() => setState((s) => ({ ...s, month: addMonths(s.month, -1) }))}
                  aria-label="Previous month">‹</button>
          <span className="label">{state.month === "all" ? "All months" : formatMonth(state.month)}</span>
          <button onClick={() => setState((s) => ({ ...s, month: addMonths(s.month, 1) }))}
                  aria-label="Next month">›</button>
        </nav>
        <input ref={searchRef} className="search" type="search" value={state.q}
               placeholder="Search  /" aria-label="Search hackathons"
               onChange={(e) => setState((s) => ({ ...s, q: e.target.value }))} />
      </header>

      <div className="layout">
        <aside className={`rail${sheetOpen ? " open" : ""}`} aria-label="Filters">
          <div className="sheet-head">
            <strong>Filters</strong>
            <button onClick={() => setSheetOpen(false)} aria-label="Close filters">×</button>
          </div>
          <Group group="scope" values={["global", "india", "city"]} counts={counts.scope}
                 selected={state.scope} onToggle={(v) => toggle("scope", v)} />
          {state.scope.includes("city") && (
            <Group group="city" values={cities} counts={counts.city}
                   selected={state.city} onToggle={(v) => toggle("city", v)} />
          )}
          <Group group="mode" values={["online", "in-person", "hybrid"]} counts={counts.mode}
                 selected={state.mode} onToggle={(v) => toggle("mode", v)} />
          <Group group="theme" values={Object.keys(LABELS.theme)} counts={counts.theme}
                 selected={state.theme} onToggle={(v) => toggle("theme", v)} />
          <Group group="org" values={["company", "university", "community", "government"]}
                 counts={counts.org} selected={state.org} onToggle={(v) => toggle("org", v)} />
          <Group group="eligibility" values={["open", "students", "women", "freshers"]}
                 counts={counts.eligibility} selected={state.eligibility}
                 onToggle={(v) => toggle("eligibility", v)} />
          <Group group="timing" values={["open", "closes-week", "starts-week"]}
                 counts={counts.timing} selected={state.timing} onToggle={(v) => toggle("timing", v)} />
          <fieldset className="group">
            <legend>More</legend>
            <label className="opt">
              <input type="checkbox" checked={state.prize}
                     onChange={() => setState((s) => ({ ...s, prize: !s.prize }))} />
              <span>Has cash prize</span>
            </label>
            <label className="opt">
              <input type="checkbox" checked={state.solo}
                     onChange={() => setState((s) => ({ ...s, solo: !s.solo }))} />
              <span>Solo allowed</span>
            </label>
          </fieldset>
        </aside>

        <main>
          <div className="results-head">
            <div className="count">
              {results.length} <em>of {monthEvents.length} this month</em>
            </div>
            {chips.map((chip) => (
              <button className="chip" key={`${chip.key}-${chip.value ?? ""}`}
                      onClick={() => drop(chip)}
                      aria-label={`Remove filter ${chip.label}`}>
                <b>{chip.key === "q" ? chip.label : label(chip.key, chip.label)}</b>
                <span aria-hidden="true">×</span>
              </button>
            ))}
            {chips.length > 0 && (
              <button className="clear"
                      onClick={() => setState((s) => ({ ...EMPTY, month: s.month }))}>Clear all</button>
            )}
          </div>

          {error && <div className="empty"><h2>Couldn’t load the data</h2><p>{error}</p></div>}
          {!data && !error && <div className="empty"><p>Loading…</p></div>}

          {data && results.length === 0 && (
            <div className="empty">
              <h2>No matches in {state.month === "all" ? "any month" : formatMonth(state.month)}</h2>
              {relax ? (
                <>
                  <p>{relax.recovered} event{relax.recovered === 1 ? "" : "s"} match if you drop{" "}
                    <b>{relax.key === "q" ? relax.label : label(relax.key, relax.label)}</b>.</p>
                  <button onClick={() => drop(relax)}>
                    Remove {relax.key === "q" ? relax.label : label(relax.key, relax.label)}
                  </button>
                </>
              ) : (
                <p>Nothing is listed for this month yet. Try another month.</p>
              )}
            </div>
          )}

          <div className="scroll" ref={scrollRef}>
            {noVirtual ? (
              <div className="grid-row"
                   style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                {results.map((event) => <Card key={event.id} event={event} today={today} />)}
              </div>
            ) : (
            <div style={{ height: virtualiser.getTotalSize(), position: "relative" }}>
              {virtualiser.getVirtualItems().map((row) => (
                <div className="grid-row" key={row.key} ref={virtualiser.measureElement}
                     data-index={row.index}
                     style={{
                       position: "absolute", top: 0, left: 0, width: "100%",
                       transform: `translateY(${row.start}px)`,
                       gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                     }}>
                  {results.slice(row.index * columns, row.index * columns + columns).map((event) => (
                    <Card key={event.id} event={event} today={today} />
                  ))}
                </div>
              ))}
            </div>
            )}
          </div>
        </main>
      </div>

      <footer className="stamp">
        {data?.last_updated
          ? <>Data last updated {new Date(data.last_updated).toLocaleString("en-GB", {
              dateStyle: "medium", timeStyle: "short",
            })} · {events.length} events tracked</>
          : "No data loaded"}
        {" · "}
        <a href="https://github.com/shreyansigheware/hackboard">how this list is built</a>
      </footer>

      <button className="sheet-btn" onClick={() => setSheetOpen(true)}>
        Filters{chips.length ? <span> · {chips.length}</span> : null}
      </button>
      {sheetOpen && <div className="scrim" onClick={() => setSheetOpen(false)} />}
    </>
  );
}
