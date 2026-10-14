import assert from "node:assert/strict";
import { suite, test } from "node:test";
import { estimateTaxMFJ } from "./tax_estimator.ts";

const zeroInputs = {
  ordinaryIncomeK: 0,
  longTermCapitalGainsK: 0,
  ordinaryInvestmentIncomeK: 0,
  charitableCashK: 0,
  charitableStockK: 0,
  saltPaidK: 0,
  shortTermCapitalGainsK: 0,
};

suite("2025 MFJ estimator", () => {
  [
    { cash: 0, stock: 40, cashAllowed: 0, stockAllowed: 40 },
    { cash: 0, stock: 80, cashAllowed: 0, stockAllowed: 60 },
    { cash: 40, stock: 60, cashAllowed: 40, stockAllowed: 60 },
    { cash: 80, stock: 60, cashAllowed: 80, stockAllowed: 20 },
    { cash: 100, stock: 60, cashAllowed: 100, stockAllowed: 0 },
    { cash: 140, stock: 60, cashAllowed: 120, stockAllowed: 0 },
  ].forEach(({ cash, stock, cashAllowed, stockAllowed }) => {
    test(`charitable caps at $200k AGI: cash=${cash}k stock=${stock}k`, () => {
      const result = estimateTaxMFJ({
        ...zeroInputs,
        ordinaryIncomeK: 200,
        charitableCashK: cash,
        charitableStockK: stock,
      });
      assert.equal(result.agi, 200_000);
      assert.equal(result.charitableCashAllowed, cashAllowed * 1000);
      assert.equal(result.charitableStockAllowed, stockAllowed * 1000);
      assert.equal(result.deductionUsed, (cashAllowed + stockAllowed) * 1000);
    });
  });

  test("small stock gifts do not displace the standard deduction", () => {
    const result = estimateTaxMFJ({ ...zeroInputs, ordinaryIncomeK: 200, charitableStockK: 10 });
    assert.equal(result.charitableStockAllowed, 10_000);
    assert.equal(result.deductionUsed, 31_500);
    assert.equal(result.itemizedUsed, false);
  });

  test("negative AGI leaves no stock deduction", () => {
    const result = estimateTaxMFJ({ ...zeroInputs, longTermCapitalGainsK: -3, charitableStockK: 10 });
    assert.equal(result.charitableStockAllowed, 0);
    assert.equal(result.totalTax, 0);
  });

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
      charitableStockK: 0,
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
      "charitableStockK",
      "saltPaidK",
    ]) {
      assert.throws(
        () => estimateTaxMFJ({ ...zeroInputs, [field]: -1 }),
        RangeError,
      );
    }
  });
});
