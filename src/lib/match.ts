// Three-way match: purchase order vs goods received vs supplier invoice.
// Pure function so the rules can be unit-tested and shown line by line.

import { lineTotal } from "./money.ts";

export type MatchLineInput = {
  poLineId: string;
  name: string;
  poQty: number;
  poPriceMinor: number;
  receivedQty: number;
  invoicedQty: number;
  invoicePriceMinor: number;
};

export type LineResult = "Matched" | "Quantity variance" | "Missing receipt" | "Price variance";

export type MatchInput = {
  lines: MatchLineInput[];
  priceTolerancePct: number;
  vendorMatches: boolean;
  currencyMatches: boolean;
  duplicateInvoice: boolean;
  invoiceDate: string;
  lastDeliveryDate: string | null;
};

export type Rule = { name: string; passed: boolean; detail: string };

export type MatchResult = {
  lines: (MatchLineInput & { result: LineResult })[];
  rules: Rule[];
  poValueMinor: number;
  receivedValueMinor: number;
  invoiceValueMinor: number;
  /** Value of invoiced quantities that have actually been received. */
  payableNowMinor: number;
  exceptionLines: number;
  status: "matched" | "exception";
};

export function threeWayMatch(input: MatchInput): MatchResult {
  const tol = input.priceTolerancePct / 100;

  const lines = input.lines.map((l) => {
    let result: LineResult = "Matched";
    if (Math.abs(l.invoicePriceMinor - l.poPriceMinor) > l.poPriceMinor * tol) result = "Price variance";
    else if (l.invoicedQty > 0 && l.receivedQty === 0) result = "Missing receipt";
    else if (l.invoicedQty > l.receivedQty) result = "Quantity variance";
    return { ...l, result };
  });

  const qtyFailures = lines.filter((l) => l.result === "Quantity variance" || l.result === "Missing receipt").length;
  const priceFailures = lines.filter((l) => l.result === "Price variance").length;
  const plural = (n: number) => `${n} line${n === 1 ? "" : "s"}`;

  const rules: Rule[] = [
    { name: "Vendor on invoice matches PO", passed: input.vendorMatches, detail: input.vendorMatches ? "Passed" : "Failed" },
    { name: "Currency matches PO", passed: input.currencyMatches, detail: input.currencyMatches ? "Passed" : "Failed" },
    {
      name: `Unit prices within ${input.priceTolerancePct}% tolerance`,
      passed: priceFailures === 0,
      detail: priceFailures === 0 ? "Passed" : `Failed, ${plural(priceFailures)}`,
    },
    {
      name: "Quantities within received amounts",
      passed: qtyFailures === 0,
      detail: qtyFailures === 0 ? "Passed" : `Failed, ${plural(qtyFailures)}`,
    },
    {
      name: "No duplicate invoice number for vendor",
      passed: !input.duplicateInvoice,
      detail: input.duplicateInvoice ? "Failed" : "Passed",
    },
  ];
  if (input.lastDeliveryDate) {
    const ok = input.invoiceDate >= input.lastDeliveryDate;
    rules.push({ name: "Invoice date after delivery date", passed: ok, detail: ok ? "Passed" : "Failed" });
  }

  const sum = (f: (l: MatchLineInput) => number) => lines.reduce((a, l) => a + f(l), 0);
  return {
    lines,
    rules,
    poValueMinor: sum((l) => lineTotal(l.poQty, l.poPriceMinor)),
    receivedValueMinor: sum((l) => lineTotal(l.receivedQty, l.poPriceMinor)),
    invoiceValueMinor: sum((l) => lineTotal(l.invoicedQty, l.invoicePriceMinor)),
    payableNowMinor: sum((l) => lineTotal(Math.min(l.invoicedQty, l.receivedQty), l.invoicePriceMinor)),
    exceptionLines: lines.filter((l) => l.result !== "Matched").length,
    status: rules.every((r) => r.passed) ? "matched" : "exception",
  };
}
