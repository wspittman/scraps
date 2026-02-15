/*
  Dead simple non-trustworthy ballpark US federal income tax estimator for Married Filing Jointly (MFJ) status.

  Inputs:
  - ordinaryIncomeK: wages, interest, short-term gains, etc (excluding dividends)
  - ltcgK: long-term capital gains (net)
  - dividendsK: ALL treated as ordinary dividends (no qualified dividend handling)
  - charitableCashK: cash contributions only (simple 60% of AGI cap)
  - saltPaidK: SALT actually paid (in WA typically property tax + estimated sales tax)
    - For sales tax, there is no flat "standard" amount. Use IRS optional tables/calculator if you do not track receipts.

  Includes:
  - Ordinary tax brackets
  - LTCG stacking (0%/15%/20%)
  - NIIT (always on; simplified)
  - Child Tax Credit (nonrefundable only; always assumes 3 qualifying children under 17)

  Ignores: AMT, payroll/SE taxes, refundable credits, QBI, most phaseouts, state tax, etc.
*/

// ===== UPDATE THESE ONCE PER YEAR (MFJ only) =====
const STD_DED = 31_500;

const ORD_BRACKETS = [
  { upTo: 23_850, rate: 0.1 },
  { upTo: 96_950, rate: 0.12 },
  { upTo: 206_700, rate: 0.22 },
  { upTo: 394_600, rate: 0.24 },
  { upTo: 501_050, rate: 0.32 },
  { upTo: 751_600, rate: 0.35 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.37 },
];

// LTCG thresholds (MFJ): top of 0% band, top of 15% band
const CG_ZERO = 96_700;
const CG_FIFTEEN = 600_050;

// SALT cap (2025+ law): base cap, phase-down above MAGI, floor cap
const SALT_BASE_CAP = 40_000;
const SALT_FLOOR_CAP = 10_000;
const SALT_PHASEOUT_START_MAGI = 500_000;
const SALT_PHASEOUT_RATE = 0.3; // reduce cap by $0.30 per $1 MAGI over start

// Child Tax Credit (simple, nonrefundable)
const CTC_PER_CHILD = 2_200;
const CTC_PHASEOUT_START = 400_000; // MFJ
const CTC_PHASEOUT_STEP = 1_000;
const CTC_PHASEOUT_PER_STEP = 50;

// NIIT (simplified)
const NIIT_THRESHOLD = 250_000; // MFJ
const NIIT_RATE = 0.038;

// Charitable cash cap (simplified)
const CHARITABLE_CASH_AGI_CAP = 0.6;
// ================================================

function clamp0(n: number) {
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function dollarsFromK(k: number) {
  return clamp0(k) * 1000;
}

function taxFromBrackets(
  taxable: number,
  brackets: { upTo: number; rate: number }[],
) {
  if (!Number.isFinite(taxable) || taxable <= 0) return 0;
  let tax = 0;
  let base = 0;
  for (const b of brackets) {
    const slice = Math.max(0, Math.min(taxable, b.upTo) - base);
    tax += slice * b.rate;
    if (taxable <= b.upTo) break;
    base = b.upTo;
  }
  return tax;
}

function saltCapMFJ(magi: number) {
  const excess = clamp0(magi - SALT_PHASEOUT_START_MAGI);
  const reduced = SALT_BASE_CAP - SALT_PHASEOUT_RATE * excess;
  return Math.max(SALT_FLOOR_CAP, reduced);
}

function childTaxCreditNonrefundable(magi: number) {
  const qualifyingChildrenUnder17 = 3; // Always assume 3 qualifying children under 17
  const base = qualifyingChildrenUnder17 * CTC_PER_CHILD;

  const excess = clamp0(magi - CTC_PHASEOUT_START);
  const steps = excess > 0 ? Math.ceil(excess / CTC_PHASEOUT_STEP) : 0;
  const reduction = steps * CTC_PHASEOUT_PER_STEP;

  return Math.max(0, base - reduction);
}

/**
 * MFJ federal tax (simple):
 * - ordinary tax on (ordinary + dividends) after deductions
 * - LTCG stacking bands on top of taxable ordinary
 * - NIIT (simplified) on (dividends + LTCG) above MAGI threshold
 * - child tax credit (nonrefundable only), assuming 3 qualifying children
 */
function estimateTaxMFJ(
  ordinaryIncomeK: number,
  ltcgK: number,
  dividendsK: number,
  charitableCashK: number,
  saltPaidK: number,
) {
  const ordinaryIncome = dollarsFromK(ordinaryIncomeK);
  const ltcg = dollarsFromK(ltcgK);
  const dividends = dollarsFromK(dividendsK);
  const charitableCash = dollarsFromK(charitableCashK);
  const saltPaid = dollarsFromK(saltPaidK);

  const ordinaryPart = ordinaryIncome + dividends;
  const agi = ordinaryPart + ltcg;
  const magi = agi; // simplified

  const charitableAllowed = Math.min(
    charitableCash,
    CHARITABLE_CASH_AGI_CAP * agi,
  );
  const saltAllowed = Math.min(saltPaid, saltCapMFJ(magi));
  const itemized = charitableAllowed + saltAllowed;
  const deductionUsed = Math.max(STD_DED, itemized);

  // Correct handling: deduction reduces ordinary first, then LTCG if any leftover.
  const taxableOrdinary = clamp0(ordinaryPart - deductionUsed);
  const taxableIncome = clamp0(agi - deductionUsed);
  const taxableLtcg = clamp0(taxableIncome - taxableOrdinary); // whatever is left is taxable LTCG

  const ordinaryTax = taxFromBrackets(taxableOrdinary, ORD_BRACKETS);

  // LTCG stacks on top of taxable ordinary income.
  const z = clamp0(Math.min(taxableLtcg, CG_ZERO - taxableOrdinary)); // 0%
  const f = clamp0(
    Math.min(taxableLtcg - z, CG_FIFTEEN - (taxableOrdinary + z)),
  ); // 15%
  const t = clamp0(taxableLtcg - z - f); // 20%
  const ltcgTax = 0 * z + 0.15 * f + 0.2 * t;

  // NIIT (simplified): min(NII, MAGI - threshold) * 3.8%
  // Simplified NII = dividends + LTCG. Real NIIT has more nuance.
  const nii = clamp0(dividends + ltcg);
  const niitBase = Math.min(nii, clamp0(magi - NIIT_THRESHOLD));
  const niitTax = niitBase * NIIT_RATE;

  const taxBeforeCredits = ordinaryTax + ltcgTax + niitTax;

  const ctc = childTaxCreditNonrefundable(magi);
  const ctcUsed = Math.min(taxBeforeCredits, ctc); // nonrefundable only
  const totalTax = Math.max(0, taxBeforeCredits - ctcUsed);

  const round = (n: number) => Math.round(n);

  return {
    agi: round(agi),
    deductionUsed: round(deductionUsed),
    itemizedUsed: deductionUsed === itemized,

    taxableOrdinary: round(taxableOrdinary),
    taxableLtcg: round(taxableLtcg),

    ordinaryTax: round(ordinaryTax),
    ltcgTax: round(ltcgTax),
    niitTax: round(niitTax),

    childTaxCreditNonrefundableUsed: round(ctcUsed),

    totalTax: round(totalTax),
  };
}

const r202x = estimateTaxMFJ(
  // ordinaryIncomeK, ltcgK, dividendsK, charitableCashK, stateTaxK
  123,
  123,
  12,
  12,
  12,
);
console.dir(r202x, { depth: null });
