// Weighted bid evaluation. The price criterion is always computed
// (lowest price earns the full weight, others pro rata); every other
// criterion is scored by the evaluation panel on its own weight scale.

export type Criterion = { id: string; name: string; weight: number; isPrice: boolean };
export type BidInput = { id: string; totalMinor: number; scores: Record<string, number> };
export type BidResult = {
  id: string;
  priceScore: number;
  criterionScores: Record<string, number>;
  weightedScore: number;
  rank: number;
  recommended: boolean;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function scoreBids(criteria: Criterion[], bids: BidInput[]): BidResult[] {
  if (bids.length === 0) return [];
  const price = criteria.find((c) => c.isPrice);
  const lowest = Math.min(...bids.map((b) => b.totalMinor));

  const scored = bids.map((bid) => {
    const criterionScores: Record<string, number> = {};
    for (const c of criteria) {
      if (c.isPrice) {
        criterionScores[c.id] = bid.totalMinor > 0 ? round1((c.weight * lowest) / bid.totalMinor) : 0;
      } else {
        // Clamp to the criterion's weight so a typo cannot exceed the maximum.
        criterionScores[c.id] = Math.min(Math.max(bid.scores[c.id] ?? 0, 0), c.weight);
      }
    }
    const weightedScore = round1(Object.values(criterionScores).reduce((a, b) => a + b, 0));
    return { id: bid.id, priceScore: price ? criterionScores[price.id] : 0, criterionScores, weightedScore };
  });

  const order = [...scored].sort((a, b) => b.weightedScore - a.weightedScore);
  return scored.map((s) => {
    const rank = order.findIndex((o) => o.id === s.id) + 1;
    return { ...s, rank, recommended: rank === 1 };
  });
}

export function weightsTotal(criteria: Criterion[]): number {
  return criteria.reduce((a, c) => a + c.weight, 0);
}
