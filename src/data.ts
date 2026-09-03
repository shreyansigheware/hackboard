import type { Dataset, Hackathon } from "./types";

/** Data is fetched at runtime, not bundled: the daily Action commits data/*.json, and a
 *  data-only commit should republish the site without anyone rebuilding it. */
export async function loadDataset(stress: boolean): Promise<Dataset> {
  const file = stress ? "stress-test.json" : "hackathons.json";
  const response = await fetch(`${import.meta.env.BASE_URL}data/${file}`, { cache: "no-cache" });
  if (!response.ok) throw new Error(`Could not load ${file} (HTTP ${response.status})`);
  const payload = (await response.json()) as Dataset;
  return { ...payload, events: payload.events ?? [] };
}

export const monthKey = (iso: string) => iso.slice(0, 7);

export function addMonths(key: string, delta: number): string {
  if (key === "all") return key;
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7)) - 1 + delta;
  const shifted = new Date(Date.UTC(year, month, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * The documented month rule: an event appears in a month if its run dates overlap that
 * month, or its registration deadline falls in it.
 *
 * This mirrors months_for() in scripts/fetch_sources.py. Two implementations of one rule is
 * a liability, so if one changes the other has to.
 */
export function monthsFor(event: Hackathon): string[] {
  const months = new Set<string>();
  if (event.starts && event.ends) {
    let cursor = monthKey(event.starts);
    const last = monthKey(event.ends);
    // Guard the loop: a corrupt row with ends before starts must not hang the page.
    for (let i = 0; i < 36 && cursor <= last; i++) {
      months.add(cursor);
      cursor = addMonths(cursor, 1);
    }
  }
  if (event.registration_closes) months.add(monthKey(event.registration_closes));
  return [...months];
}

export const formatMonth = (key: string) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long", year: "numeric", timeZone: "UTC",
  });

const DAY = 86_400_000;
export const daysUntil = (iso: string, today: Date) =>
  Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(
    today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / DAY);

export function formatRun(event: Hackathon): string {
  if (!event.starts || !event.ends) return "Run dates not published";
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", timeZone: "UTC" };
  const from = new Date(`${event.starts}T00:00:00Z`);
  const to = new Date(`${event.ends}T00:00:00Z`);
  const right = to.toLocaleDateString("en-GB", { ...opts, year: "numeric" });
  if (event.starts === event.ends) return right;
  // Show the year on the left too when the window crosses a new year, or "1 Jul – 1 Jun 2027"
  // reads as ending before it begins.
  const sameYear = event.starts.slice(0, 4) === event.ends.slice(0, 4);
  const left = from.toLocaleDateString("en-GB", sameYear ? opts : { ...opts, year: "numeric" });
  return `${left} – ${right}`;
}

/**
 * Results are ordered by what a visitor can act on soonest: the nearest future deadline
 * first, then the nearest start date, with anything already past pushed to the end.
 * Sorting by start date -- the order the data arrives in -- buries the events closing this
 * week under six-month-long online challenges, which is the opposite of the point.
 */
export function sortKey(event: Hackathon, today: Date): number {
  const closes = event.registration_closes ? daysUntil(event.registration_closes, today) : null;
  const starts = event.starts ? daysUntil(event.starts, today) : null;
  const future = [closes, starts].filter((d): d is number => d !== null && d >= 0);
  if (future.length) return Math.min(...future);
  // Nothing upcoming: order by how recently it was relevant, after everything upcoming.
  const past = [closes, starts].filter((d): d is number => d !== null);
  return 100_000 - (past.length ? Math.max(...past) : 0);
}

const SYMBOL: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£", OTHER: "" };

export function formatPrize(prize: Hackathon["prize"]): string | null {
  if (!prize) return null;
  if (prize.amount === 0) return "No cash prize";
  // Indian grouping for rupees, western grouping for everything else -- ₹5,00,000 is what a
  // reader in Bengaluru expects to see, and $740,000 is what everyone else does.
  const locale = prize.currency === "INR" ? "en-IN" : "en-US";
  return `${SYMBOL[prize.currency] ?? ""}${prize.amount.toLocaleString(locale)}`;
}

export function formatTeam(team: Hackathon["team"]): string {
  if (team.max === null) return team.min <= 1 ? "Solo allowed" : `Teams of ${team.min}+`;
  if (team.max === team.min) return team.min === 1 ? "Solo only" : `Teams of ${team.min}`;
  return `Teams of ${team.min}–${team.max}`;
}
