export type License = {
  key_hint: string;
  term_months: number;
  starts_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
};

export const PRICE_PER_YEAR_USD = 1500;

/** The end of the organisation's licensed period if a license covers now, else null. */
export function licensedUntil(licenses: License[] | null | undefined, now = Date.now()): string | null {
  const valid = (licenses ?? []).filter((l) => !l.revoked_at && l.starts_at && l.expires_at);
  if (!valid.some((l) => Date.parse(l.starts_at!) <= now && Date.parse(l.expires_at!) > now)) return null;
  // Renewals start where the previous license ends, so the latest expiry is the end of cover.
  return valid.map((l) => l.expires_at!).sort().at(-1)!;
}
