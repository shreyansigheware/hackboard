/** Mirrors schema/hackathon.schema.json. The Python validator is the enforcer; this is the
 *  shape the UI may assume once a row has passed it. */
export type Scope = "global" | "india" | "city";
export type Mode = "online" | "in-person" | "hybrid";
export type OrgType = "company" | "university" | "community" | "government";
export type Theme =
  | "ai" | "web3" | "fintech" | "healthtech" | "cybersecurity"
  | "open-source" | "sustainability" | "hardware" | "other";
export type Eligibility = "open" | "students" | "women" | "freshers";
export type Currency = "INR" | "USD" | "EUR" | "GBP" | "OTHER";

export interface Hackathon {
  id: string;
  name: string;
  organiser: { name: string; type: OrgType };
  scope: Scope;
  city?: string;
  location?: string | null;
  mode: Mode;
  themes: Theme[];
  /** null when the source publishes only a registration window. Never inferred. */
  starts: string | null;
  ends: string | null;
  registration_closes: string | null;
  prize: { amount: number; currency: Currency } | null;
  team: { min: number; max: number | null };
  eligibility: Eligibility;
  url: string;
  source: string;
  source_url: string;
  also_seen_at?: string[];
  first_seen: string;
  last_seen: string;
  locked?: boolean;
  synthetic?: boolean;
}

export interface Dataset {
  last_updated: string | null;
  events: Hackathon[];
}
