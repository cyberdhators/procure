const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const shortFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const stampFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
});

export const formatDate = (d: string | null | undefined) => (d ? dateFmt.format(new Date(d)) : "—");
export const formatShortDate = (d: string | null | undefined) => (d ? shortFmt.format(new Date(d)) : "");
export const formatStamp = (d: string) => stampFmt.format(new Date(d)).replace(",", "");

export function daysSince(d: string | null | undefined): number {
  if (!d) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000));
}

export function daysUntil(d: string): number {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return Math.round((new Date(d).getTime() - today.getTime()) / 86_400_000);
}

export function ago(d: string | null | undefined): string {
  const n = daysSince(d);
  if (n === 0) return "today";
  return n === 1 ? "1 day ago" : `${n} days ago`;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function humanize(s: string): string {
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
