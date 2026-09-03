import type { Eligibility, Hackathon, Mode, OrgType, Scope, Theme } from "./types";
import { daysUntil, monthsFor } from "./data";

export interface FilterState {
  month: string;
  scope: Scope[];
  city: string[];
  mode: Mode[];
  org: OrgType[];
  theme: Theme[];
  eligibility: Eligibility[];
  timing: Timing[];
  prize: boolean;
  solo: boolean;
  q: string;
}

export type Timing = "open" | "closes-week" | "starts-week";

export const EMPTY: Omit<FilterState, "month"> = {
  scope: [], city: [], mode: [], org: [], theme: [], eligibility: [],
  timing: [], prize: false, solo: false, q: "",
};

/** Categories combine with AND; values inside one category combine with OR. */
type ListKey = "scope" | "city" | "mode" | "org" | "theme" | "eligibility" | "timing";
const LIST_KEYS: ListKey[] = ["scope", "city", "mode", "org", "theme", "eligibility", "timing"];

function matchesTiming(event: Hackathon, timing: Timing[], today: Date): boolean {
  if (timing.length === 0) return true;
  const closes = event.registration_closes ? daysUntil(event.registration_closes, today) : null;
  const starts = event.starts ? daysUntil(event.starts, today) : null;
  return timing.some((t) => {
    // "Registration open" means a deadline that has not passed. A row with no published
    // deadline is unknown, not open -- claiming otherwise sends someone to a closed form.
    if (t === "open") return closes !== null && closes >= 0;
    if (t === "closes-week") return closes !== null && closes >= 0 && closes <= 7;
    return starts !== null && starts >= 0 && starts <= 7;
  });
}

function haystack(event: Hackathon): string {
  return `${event.name} ${event.organiser.name} ${event.city ?? ""} ${event.location ?? ""} ${event.themes.join(" ")}`
    .toLowerCase();
}

/** One predicate per category, so a category can be excluded when counting its own options. */
export function predicates(state: FilterState, today: Date) {
  const query = state.q.trim().toLowerCase();
  return {
    // "all" is the stress-test mode: it drops the month frame so every row in the fixture
    // renders at once, which is the only way to measure the 1,000-item bar honestly.
    month: (e: Hackathon) => state.month === "all" || monthsFor(e).includes(state.month),
    scope: (e: Hackathon) => state.scope.length === 0 || state.scope.includes(e.scope),
    city: (e: Hackathon) => state.city.length === 0 || (!!e.city && state.city.includes(e.city)),
    mode: (e: Hackathon) => state.mode.length === 0 || state.mode.includes(e.mode),
    org: (e: Hackathon) => state.org.length === 0 || state.org.includes(e.organiser.type),
    theme: (e: Hackathon) => state.theme.length === 0 || e.themes.some((t) => state.theme.includes(t)),
    eligibility: (e: Hackathon) =>
      state.eligibility.length === 0 || state.eligibility.includes(e.eligibility),
    timing: (e: Hackathon) => matchesTiming(e, state.timing, today),
    prize: (e: Hackathon) => !state.prize || (!!e.prize && e.prize.amount > 0),
    solo: (e: Hackathon) => !state.solo || e.team.min <= 1,
    q: (e: Hackathon) => query === "" || haystack(e).includes(query),
  };
}

export function applyFilters(events: Hackathon[], state: FilterState, today: Date): Hackathon[] {
  const p = predicates(state, today);
  const checks = Object.values(p);
  return events.filter((event) => checks.every((check) => check(event)));
}

/**
 * Counts shown next to each option. Each category is counted with its *own* filter removed,
 * so "Bangalore (12)" means "12 more if you tick this", not "12 given you already ticked it".
 * Counting with every filter applied makes every unticked option read 0 and the counts useless.
 */
export function optionCounts(events: Hackathon[], state: FilterState, today: Date) {
  const p = predicates(state, today);
  const counts: Record<string, Record<string, number>> = {};
  for (const key of LIST_KEYS) {
    const others = Object.entries(p)
      .filter(([name]) => name !== key)
      .map(([, check]) => check);
    const pool = events.filter((event) => others.every((check) => check(event)));
    const bucket: Record<string, number> = {};
    for (const event of pool) {
      const values: string[] =
        key === "scope" ? [event.scope]
        : key === "city" ? (event.city ? [event.city] : [])
        : key === "mode" ? [event.mode]
        : key === "org" ? [event.organiser.type]
        : key === "theme" ? event.themes
        : key === "eligibility" ? [event.eligibility]
        : (["open", "closes-week", "starts-week"] as Timing[])
            .filter((t) => matchesTiming(event, [t], today));
      for (const value of values) bucket[value] = (bucket[value] ?? 0) + 1;
    }
    counts[key] = bucket;
  }
  return counts;
}

/**
 * The zero-result state has to help. Finds the single active filter whose removal recovers
 * the most events, so the empty state can name it and offer a button that drops it.
 */
export function bestRelaxation(
  events: Hackathon[], state: FilterState, today: Date,
): { key: ListKey | "prize" | "solo" | "q"; value?: string; label: string; recovered: number } | null {
  const candidates: { key: ListKey | "prize" | "solo" | "q"; value?: string; label: string }[] = [];
  for (const key of LIST_KEYS) {
    for (const value of state[key] as string[]) candidates.push({ key, value, label: value });
  }
  if (state.prize) candidates.push({ key: "prize", label: "Has cash prize" });
  if (state.solo) candidates.push({ key: "solo", label: "Solo allowed" });
  if (state.q.trim()) candidates.push({ key: "q", label: `“${state.q.trim()}”` });

  let best: { key: ListKey | "prize" | "solo" | "q"; value?: string; label: string; recovered: number } | null = null;
  for (const candidate of candidates) {
    const relaxed: FilterState = { ...state };
    if (candidate.key === "prize") relaxed.prize = false;
    else if (candidate.key === "solo") relaxed.solo = false;
    else if (candidate.key === "q") relaxed.q = "";
    else relaxed[candidate.key] = (state[candidate.key] as string[])
      .filter((v) => v !== candidate.value) as never;
    const recovered = applyFilters(events, relaxed, today).length;
    if (recovered > 0 && (!best || recovered > best.recovered)) best = { ...candidate, recovered };
  }
  return best;
}

const MANAGED = ["month", "prize", "solo", "q", ...LIST_KEYS];

/**
 * Filter state lives in the URL, so a filtered view is shareable and the back button works.
 * Params this module does not own are carried through untouched -- rebuilding the query
 * string from scratch silently dropped anything else the link arrived with.
 */
export function toSearchParams(state: FilterState, existing = ""): string {
  const params = new URLSearchParams(existing);
  for (const key of MANAGED) params.delete(key);
  params.set("month", state.month);
  for (const key of LIST_KEYS) {
    const values = state[key] as string[];
    if (values.length) params.set(key, values.join(","));
  }
  if (state.prize) params.set("prize", "1");
  if (state.solo) params.set("solo", "1");
  if (state.q.trim()) params.set("q", state.q.trim());
  return params.toString();
}

export function fromSearchParams(search: string, fallbackMonth: string): FilterState {
  const params = new URLSearchParams(search);
  const list = (key: string) =>
    (params.get(key) ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  const month = params.get("month");
  return {
    month: month && /^\d{4}-\d{2}$/.test(month) ? month : fallbackMonth,
    scope: list("scope") as Scope[],
    city: list("city"),
    mode: list("mode") as Mode[],
    org: list("org") as OrgType[],
    theme: list("theme") as Theme[],
    eligibility: list("eligibility") as Eligibility[],
    timing: list("timing") as Timing[],
    prize: params.get("prize") === "1",
    solo: params.get("solo") === "1",
    q: params.get("q") ?? "",
  };
}

export function activeChips(state: FilterState) {
  const chips: { key: ListKey | "prize" | "solo" | "q"; value?: string; label: string }[] = [];
  for (const key of LIST_KEYS) {
    for (const value of state[key] as string[]) chips.push({ key, value, label: value });
  }
  if (state.prize) chips.push({ key: "prize", label: "Has cash prize" });
  if (state.solo) chips.push({ key: "solo", label: "Solo allowed" });
  if (state.q.trim()) chips.push({ key: "q", label: `“${state.q.trim()}”` });
  return chips;
}
