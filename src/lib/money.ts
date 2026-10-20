// Money is carried as integer minor units (cents) everywhere; these helpers
// are the only place that converts to and from display strings.

const fmt2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatMoney(minor: number | bigint | string | null | undefined): string {
  return fmt2.format(Number(minor ?? 0) / 100);
}

export function formatWhole(minor: number | bigint | string | null | undefined): string {
  return fmt0.format(Math.round(Number(minor ?? 0) / 100));
}

/** Parses "1,234.5" into 123450. Returns null for blank or invalid input. */
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** qty × unit price, rounded to the nearest minor unit. */
export function lineTotal(qty: number | string, unitMinor: number | string): number {
  return Math.round(Number(qty) * Number(unitMinor));
}

export function formatQty(qty: number | string): string {
  const n = Number(qty);
  return Number.isInteger(n) ? fmt0.format(n) : fmt2.format(n);
}
