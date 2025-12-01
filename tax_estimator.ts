/*
  Dead simple non-trustworthy ballpark US federal tax estimator for Married Filing Jointly (MFJ) status.
  `tsx tax_estimator.ts`
*/

// ===== UPDATE THESE ONCE PER YEAR (MFJ only) =====
const STD_DED = 29200; // standard deduction (MFJ)
const ORD_BRACKETS: { upTo: number; rate: number }[] = [
  { upTo: 23200, rate: 0.1 },
  { upTo: 94300, rate: 0.12 },
  { upTo: 201050, rate: 0.22 },
  { upTo: 383900, rate: 0.24 },
  { upTo: 487450, rate: 0.32 },
  { upTo: 731200, rate: 0.35 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.37 },
];
// LTCG/Qualified Div thresholds (MFJ): top of 0% band, top of 15% band
const CG_ZERO = 94250;
const CG_FIFTEEN = 583750;
// ================================================

function taxFromBrackets(
  taxable: number,
  brackets: { upTo: number; rate: number }[]
): number {
  if (taxable <= 0) return 0;
  let tax = 0,
    base = 0;
  for (const b of brackets) {
    const slice = Math.max(0, Math.min(taxable, b.upTo) - base);
    tax += slice * b.rate;
    if (taxable <= b.upTo) break;
    base = b.upTo;
  }
  return tax;
}

/**
 * MFJ federal tax (simple): ordinary + LTCG/qualified dividends layering + 60% AGI cap on cash charitable.
 * Ignores AMT, NIIT, credits, SE tax, phaseouts, state, etc.
 */
export function estimateTaxMFJ(
  ordinaryIncomeK: number,
  ltcgK: number,
  charitableK: number
) {
  const ordinaryIncome = ordinaryIncomeK * 1000;
  const ltcg = ltcgK * 1000;
  const charitable = charitableK * 1000;

  const agi = Math.max(0, ordinaryIncome + ltcg);
  const charitableAllowed = Math.min(charitable, 0.6 * agi);
  const stateTaxDeduction = 10000;
  const deduction = Math.max(STD_DED, charitableAllowed + stateTaxDeduction);

  const toi = Math.max(0, ordinaryIncome - deduction); // taxable ordinary income
  const ordinaryTax = taxFromBrackets(toi, ORD_BRACKETS);

  // Capital gains stack on top of ordinary income, filling 0% band first.
  const z = Math.max(0, Math.min(ltcg, CG_ZERO - toi)); // 0%
  const f = Math.max(0, Math.min(ltcg - z, CG_FIFTEEN - (toi + z))); // 15%
  const t = Math.max(0, ltcg - z - f); // 20%
  const cgTax = Math.floor(0 * z + 0.15 * f + 0.2 * t);

  return {
    agi,
    deductionUsed: deduction,
    taxableOrdinary: toi,
    ordinaryTax,
    cgTax,
    totalTax: ordinaryTax + cgTax,
    totalTaxWithObservedAdjustment: Math.floor(
      0.95 * (ordinaryTax + cgTax) - 5000
    ),
  };
}

const r202x = estimateTaxMFJ(123, 4, 56);
console.dir(r202x, { depth: null });
