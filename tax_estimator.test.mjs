import assert from "node:assert/strict";
import { suite, test } from "node:test";
import { estimateTaxMFJ } from "./tax_estimator.ts";

const zeroInputs = {
  ordinaryIncomeK: 0,
  longTermCapitalGainsK: 0,
  ordinaryInvestmentIncomeK: 0,
  charitableCashK: 0,
  saltPaidK: 0,
  shortTermCapitalGainsK: 0,
};

suite("2025 MFJ estimator", () => {
  test("child credit cannot offset NIIT", () => {
    const result = estimateTaxMFJ({
      ...zeroInputs,
      longTermCapitalGainsK: 260,
      charitableCashK: 156,
      saltPaidK: 40,
    });
    assert.equal(result.childTaxCreditNonrefundableUsed, 0);
    assert.equal(result.niitTax, 380);
    assert.equal(result.totalTax, 380);
  });

  [
    { name: "combined interest and dividends", investmentIncome: 50, shortTerm: 0 },
    { name: "short-term gain", investmentIncome: 0, shortTerm: 50 },
  ].forEach(({ name, investmentIncome, shortTerm }) => {
    test(`${name} is included in ordinary tax and NIIT`, () => {
      const result = estimateTaxMFJ({
        ...zeroInputs,
        ordinaryIncomeK: 250,
        ordinaryInvestmentIncomeK: investmentIncome,
        shortTermCapitalGainsK: shortTerm,
      });
      assert.equal(result.agi, 300_000);
      assert.equal(result.niitTax, 1_900);
      assert.equal(result.totalTax, 45_434);
    });
  });

  [
    { lt: -3, st: 0, agi: 197_000, ordinary: 165_500, gains: 0, total: 19_638 },
    {
      lt: -30,
      st: 0,
      agi: 197_000,
      ordinary: 165_500,
      gains: 0,
      total: 19_638,
    },
    {
      lt: -10,
      st: 20,
      agi: 210_000,
      ordinary: 178_500,
      gains: 0,
      total: 22_498,
    },
    {
      lt: 20,
      st: -10,
      agi: 210_000,
      ordinary: 168_500,
      gains: 10_000,
      total: 21_798,
    },
    {
      lt: -10,
      st: 10,
      agi: 200_000,
      ordinary: 168_500,
      gains: 0,
      total: 20_298,
    },
  ].forEach(({ lt, st, agi, ordinary, gains, total }) => {
    test(`net capital amounts LT=${lt}k ST=${st}k`, () => {
      const result = estimateTaxMFJ({
        ...zeroInputs,
        ordinaryIncomeK: 200,
        longTermCapitalGainsK: lt,
        shortTermCapitalGainsK: st,
      });
      assert.equal(result.agi, agi);
      assert.equal(result.taxableOrdinary, ordinary);
      assert.equal(result.taxableLtcg, gains);
      assert.equal(result.totalTax, total);
    });
  });

  test("capital loss reduces NIIT only by the current deductible amount", () => {
    assert.equal(
      estimateTaxMFJ({
        ...zeroInputs,
        ordinaryIncomeK: 300,
        longTermCapitalGainsK: -30,
        ordinaryInvestmentIncomeK: 10,
      }).niitTax,
      266,
    );
  });

  test("negative AGI cannot produce a negative charitable deduction", () => {
    const result = estimateTaxMFJ({
      ...zeroInputs,
      longTermCapitalGainsK: -30,
      charitableCashK: 5,
      saltPaidK: 40,
    });
    assert.equal(result.agi, -3_000);
    assert.equal(result.deductionUsed, 40_000);
    assert.equal(result.totalTax, 0);
  });

  test("original example retains its result and declares its tax year", () => {
    const result = estimateTaxMFJ({
      ordinaryIncomeK: 123,
      longTermCapitalGainsK: 123,
      ordinaryInvestmentIncomeK: 12,
      charitableCashK: 12,
      saltPaidK: 12,
      shortTermCapitalGainsK: 0,
    });
    assert.equal(result.taxYear, 2025);
    assert.equal(result.totalTax, 24_752);
  });

  [NaN, Infinity, -Infinity, Number.MAX_VALUE].forEach((invalid) => {
    test(`rejects invalid input ${invalid} in every field`, () => {
      for (const field of Object.keys(zeroInputs)) {
        assert.throws(
          () => estimateTaxMFJ({ ...zeroInputs, [field]: invalid }),
          RangeError,
        );
      }
    });
  });

  test("rejects negative non-capital inputs", () => {
    for (const field of [
      "ordinaryIncomeK",
      "ordinaryInvestmentIncomeK",
      "charitableCashK",
      "saltPaidK",
    ]) {
      assert.throws(
        () => estimateTaxMFJ({ ...zeroInputs, [field]: -1 }),
        RangeError,
      );
    }
  });
});
