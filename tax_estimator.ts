/*
  Ballpark US federal income tax estimator for tax year 2025 only, Married Filing Jointly (MFJ).

  Includes:
  - Ordinary tax brackets
  - LTCG stacking (0%/15%/20%)
  - NIIT (always on; simplified)
  - Child Tax Credit (nonrefundable only; always assumes 3 qualifying children under 17)

  Ignores: AMT, payroll/SE taxes, refundable credits, QBI, most phaseouts, state tax, etc.
*/

/** Tax inputs, in thousands of dollars. */
export interface TaxInputsMFJ {
  /** Non-investment ordinary income, excluding interest, dividends and capital gains. */
  ordinaryIncomeK: number;
  /** Taxable investment interest plus dividends, all treated as ordinary income (no qualified-dividend handling). */
  ordinaryInvestmentIncomeK: number;
  /** Net long-term investment capital gains/losses, including applicable carryovers. */
  longTermCapitalGainsK: number;
  /** Cash contributions only (simple 60% of AGI cap) */
  charitableCashK: number;
  /**
   * SALT actually paid (in WA typically property tax + estimated sales tax)
   * - For sales tax, there is no flat "standard" amount. Use IRS optional tables/calculator if you do not track receipts.
   */
  saltPaidK: number;
  /** Net short-term investment capital gains/losses; defaults to zero. */
  shortTermCapitalGainsK: number;
}

// Edit these values to compare estimates. All amounts are in thousands of dollars.
const taxInputsMFJ: TaxInputsMFJ = {
  ordinaryIncomeK: 123,
  ordinaryInvestmentIncomeK: 12,
  longTermCapitalGainsK: 123,
  charitableCashK: 12,
  saltPaidK: 12,
  shortTermCapitalGainsK: 0,
};

// #region TAX YEAR 2025 (MFJ only); later years also require reviewing calculation rules

const TAX_YEAR = 2025;
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

// SALT cap for 2025: base cap, phase-down above MAGI, floor cap
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

// #endregion

function clamp0(n: number) {
  return Math.max(0, n);
}

function dollarsFromK(k: number, name: string, allowNegative = false) {
  if (!Number.isFinite(k) || Math.abs(k * 1000) > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(
      `${name} must be finite and within the supported dollar range`,
    );
  }
  if (!allowNegative && k < 0) {
    throw new RangeError(`${name} must be nonnegative`);
  }
  return k * 1000;
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
 * - ordinary tax on non-investment income, interest, dividends and net short-term gains
 * - LTCG stacking bands on top of taxable ordinary
 * - NIIT (simplified) on investment income above MAGI threshold
 * - child tax credit (nonrefundable only), assuming 3 qualifying children
 */
export function estimateTaxMFJ({
  ordinaryIncomeK,
  longTermCapitalGainsK,
  ordinaryInvestmentIncomeK,
  charitableCashK,
  saltPaidK,
  shortTermCapitalGainsK,
}: TaxInputsMFJ) {
  const ordinaryIncome = dollarsFromK(ordinaryIncomeK, "ordinaryIncomeK");
  const ltcg = dollarsFromK(
    longTermCapitalGainsK,
    "longTermCapitalGainsK",
    true,
  );
  const ordinaryInvestmentIncome = dollarsFromK(
    ordinaryInvestmentIncomeK,
    "ordinaryInvestmentIncomeK",
  );
  const charitableCash = dollarsFromK(charitableCashK, "charitableCashK");
  const saltPaid = dollarsFromK(saltPaidK, "saltPaidK");
  const stcg = dollarsFromK(
    shortTermCapitalGainsK,
    "shortTermCapitalGainsK",
    true,
  );

  // Opposite-sign capital amounts offset each other before applying tax rates.
  const netCapital = stcg + ltcg;
  const positiveCapital = clamp0(netCapital);
  const longTermGain = Math.min(clamp0(ltcg), positiveCapital);
  const shortTermGain = positiveCapital - longTermGain;
  const capitalLossDeduction = Math.min(3_000, clamp0(-netCapital));
  const ordinaryPart =
    ordinaryIncome +
    ordinaryInvestmentIncome +
    shortTermGain -
    capitalLossDeduction;
  const agi = ordinaryPart + longTermGain;
  const magi = agi; // simplified

  const charitableAllowed = Math.min(
    charitableCash,
    CHARITABLE_CASH_AGI_CAP * clamp0(agi),
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
  // Only the deductible portion of a net capital loss reduces this year's NII.
  // Investment expenses and other NIIT adjustments remain outside this model.
  const nii = clamp0(
    ordinaryInvestmentIncome + positiveCapital - capitalLossDeduction,
  );
  const niitBase = Math.min(nii, clamp0(magi - NIIT_THRESHOLD));
  const niitTax = niitBase * NIIT_RATE;

  const taxBeforeCredits = ordinaryTax + ltcgTax;

  const ctc = childTaxCreditNonrefundable(magi);
  const ctcUsed = Math.min(taxBeforeCredits, ctc); // nonrefundable only
  const totalTax = Math.max(0, taxBeforeCredits - ctcUsed) + niitTax;

  const round = (n: number) => Math.round(n);

  return {
    taxYear: TAX_YEAR,
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

if (import.meta.main) {
  const r2025 = estimateTaxMFJ(taxInputsMFJ);
  console.dir(r2025, { depth: null });
}
