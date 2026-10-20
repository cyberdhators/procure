import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMoney, lineTotal, parseMoney } from "./money.ts";
import { scoreBids, type Criterion } from "./scoring.ts";
import { threeWayMatch } from "./match.ts";

test("money parses and formats minor units", () => {
  assert.equal(parseMoney("1,234.5"), 123450);
  assert.equal(parseMoney("62.75"), 6275);
  assert.equal(parseMoney("abc"), null);
  assert.equal(parseMoney("1.234"), null);
  assert.equal(formatMoney(1795000), "17,950.00");
  assert.equal(lineTotal(160, 6275), 1004000);
});

// RFQ-0031 from the mockups. The deck showed 86.4 / 79.0 / 71.5, but the
// criterion scores actually sum to 96.0 / 79.0 / 87.5.
const criteria: Criterion[] = [
  { id: "price", name: "Total price", weight: 40, isPrice: true },
  { id: "comp", name: "Compliance", weight: 25, isPrice: false },
  { id: "lead", name: "Lead time", weight: 15, isPrice: false },
  { id: "perf", name: "Past performance", weight: 10, isPrice: false },
  { id: "lic", name: "Licences", weight: 10, isPrice: false },
];

test("bid scoring computes price score and weighted totals", () => {
  const r = scoreBids(criteria, [
    { id: "A", totalMinor: 1795000, scores: { comp: 25, lead: 14, perf: 8.6, lic: 10 } },
    { id: "B", totalMinor: 1723000, scores: { comp: 18, lead: 9, perf: 7.8, lic: 4.2 } },
    { id: "C", totalMinor: 1940000, scores: { comp: 25, lead: 12, perf: 5, lic: 10 } },
  ]);
  const byId = Object.fromEntries(r.map((x) => [x.id, x]));
  assert.equal(byId.A.priceScore, 38.4);
  assert.equal(byId.B.priceScore, 40);
  assert.equal(byId.C.priceScore, 35.5);
  assert.equal(byId.A.weightedScore, 96);
  assert.equal(byId.B.weightedScore, 79);
  assert.equal(byId.C.weightedScore, 87.5);
  assert.deepEqual([byId.A.rank, byId.C.rank, byId.B.rank], [1, 2, 3]);
  assert.ok(byId.A.recommended);
});

test("bid scoring clamps panel scores to the criterion weight", () => {
  const [r] = scoreBids(criteria, [{ id: "X", totalMinor: 100, scores: { comp: 99 } }]);
  assert.equal(r.criterionScores.comp, 25);
});

// INV-2207 from the mockups. The deck showed GRN value 8,020.00; the received
// quantities are actually worth 7,795.00.
test("three-way match flags quantity variance and missing receipt", () => {
  const m = threeWayMatch({
    priceTolerancePct: 0,
    vendorMatches: true,
    currencyMatches: true,
    duplicateInvoice: false,
    invoiceDate: "2026-09-21",
    lastDeliveryDate: "2026-09-19",
    lines: [
      { poLineId: "1", name: "Gloves", poQty: 400, poPriceMinor: 920, receivedQty: 400, invoicedQty: 400, invoicePriceMinor: 920 },
      { poLineId: "2", name: "Masks", poQty: 600, poPriceMinor: 390, receivedQty: 600, invoicedQty: 600, invoicePriceMinor: 390 },
      { poLineId: "3", name: "Antiseptic", poQty: 120, poPriceMinor: 1775, receivedQty: 100, invoicedQty: 120, invoicePriceMinor: 1775 },
      { poLineId: "4", name: "Test kits", poQty: 160, poPriceMinor: 6125, receivedQty: 0, invoicedQty: 160, invoicePriceMinor: 6125 },
    ],
  });
  assert.deepEqual(m.lines.map((l) => l.result), ["Matched", "Matched", "Quantity variance", "Missing receipt"]);
  assert.equal(m.poValueMinor, 1795000);
  assert.equal(m.invoiceValueMinor, 1795000);
  assert.equal(m.receivedValueMinor, 779500);
  assert.equal(m.payableNowMinor, 779500);
  assert.equal(m.status, "exception");
  assert.equal(m.rules.find((r) => r.name.startsWith("Quantities"))?.detail, "Failed, 2 lines");
});

test("three-way match passes a clean invoice and catches price drift", () => {
  const base = {
    priceTolerancePct: 2,
    vendorMatches: true,
    currencyMatches: true,
    duplicateInvoice: false,
    invoiceDate: "2026-09-21",
    lastDeliveryDate: "2026-09-19",
  };
  const line = { poLineId: "1", name: "Paper", poQty: 10, poPriceMinor: 1000, receivedQty: 10, invoicedQty: 10 };
  assert.equal(threeWayMatch({ ...base, lines: [{ ...line, invoicePriceMinor: 1015 }] }).status, "matched");
  const drift = threeWayMatch({ ...base, lines: [{ ...line, invoicePriceMinor: 1100 }] });
  assert.equal(drift.lines[0].result, "Price variance");
  assert.equal(drift.status, "exception");
});
