/* Smoke tests for the Alpha International shareholder-financing engine.
 *
 * Written before the module. Each expected number is worked by hand from the
 * deal mechanics (draw, interest, tax release, sweep), not by calling the
 * module a second way, so a wrong engine cannot agree with a wrong test.
 *
 *   node --test test/
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEAL_DEFAULTS, effectiveAnnualRate, taxableSeries, shareholderLoan,
  selfFunded, compareFinancing, npvMid, DealError,
} from '../hub/tools/alpha-intl-finance.js';

const near = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: got ${a}, expected ${b} (±${tol})`);

describe('deal defaults', () => {
  test('carry the Alpha International terms', () => {
    assert.equal(DEAL_DEFAULTS.partnerShare, 0.65);
    assert.equal(DEAL_DEFAULTS.partnerRate, 0.20);
    assert.equal(DEAL_DEFAULTS.sweepPct, 1);
    assert.ok(DEAL_DEFAULTS.thirdPartyRate < DEAL_DEFAULTS.partnerRate);
  });
});

describe('effectiveAnnualRate', () => {
  test('annual compounding is the nominal rate', () => {
    assert.equal(effectiveAnnualRate(0.20, 1), 0.20);
  });
  test('monthly compounding of 20% is 21.94%', () => {
    near(effectiveAnnualRate(0.20, 12), 0.219391, 1e-6, 'EAR monthly');
  });
  test('rejects a negative rate', () => {
    assert.throws(() => effectiveAnnualRate(-0.1, 1), DealError);
  });
});

describe('taxableSeries', () => {
  test('adds back capex and deducts straight-line depreciation from the year spent', () => {
    // fcf already net of capex; capex 100 in year 0 over 2 years = 50/yr.
    const t = taxableSeries([-100, 60, 60], [100, 0, 0], 2);
    assert.deepEqual(t, [-50, 10, 60]);
  });
  test('depreciation running past the horizon is truncated', () => {
    const t = taxableSeries([0, -90], [0, 90], 3);
    assert.deepEqual(t, [0, -30]);
  });
});

describe('shareholderLoan: hand-worked case', () => {
  // Principals 50% share, 10% annual, no tax, full sweep, draw at mid-year.
  // Year 0: share = -100 -> draw 100, interest 100*(1.1^0.5-1) = 4.8809
  //         closing 104.8809
  // Year 1: share = +60 -> interest 10.4881, owed 115.3690, sweep 60
  //         closing 55.3690
  // Year 2: share = +80 -> interest 5.5369, owed 60.9059, sweep 60.9059
  //         principals keep 19.0941, closing 0, repaid in year index 2.
  const r = shareholderLoan({ fcf: [-200, 120, 160], taxable: [0, 0, 0] },
    { share: 0.5, rate: 0.10, compounding: 1, sweepPct: 1, taxRate: 0, fee: 0 });
  test('balances roll forward as worked', () => {
    near(r.rows[0].draw, 100, 1e-9, 'draw y0');
    near(r.rows[0].interest, 4.880885, 1e-5, 'interest y0');
    near(r.rows[0].closing, 104.880885, 1e-5, 'closing y0');
    near(r.rows[1].sweep, 60, 1e-9, 'sweep y1');
    near(r.rows[1].closing, 55.368973, 1e-5, 'closing y1');
    near(r.rows[2].sweep, 60.905870, 1e-5, 'sweep y2');
    near(r.rows[2].toPrincipals, 19.094130, 1e-5, 'kept y2');
    near(r.rows[2].closing, 0, 1e-9, 'closing y2');
  });
  test('summary numbers agree with the rows', () => {
    assert.equal(r.payoffIndex, 2);
    near(r.totalInterest, 4.880885 + 10.488089 + 5.536897, 1e-4, 'total interest');
    near(r.peakBalance, 115.368974, 1e-4, 'peak owed');
    near(r.totalDrawn, 100, 1e-9, 'drawn');
    near(r.endingBalance, 0, 1e-9, 'ending');
  });
  test('lender cash is draw out, sweep in', () => {
    near(r.rows[0].lenderCF, -100, 1e-9, 'lender y0');
    near(r.rows[1].lenderCF, 60, 1e-9, 'lender y1');
  });
});

describe('shareholderLoan: tax release comes before the sweep', () => {
  // No borrowing needed in year 0; balance seeded by a year of draw.
  // Year 0: share -50 -> draw 50, 0% interest. Taxable share year 1 = 40,
  // tax 25% = 10, released first; sweep takes the remaining 50 of 60.
  const r = shareholderLoan({ fcf: [-100, 120], taxable: [0, 80] },
    { share: 0.5, rate: 0, compounding: 1, sweepPct: 1, taxRate: 0.25, fee: 0, interestDeductible: true });
  test('tax is released, then the sweep repays from what is left', () => {
    near(r.rows[1].taxRelease, 10, 1e-9, 'tax release');
    near(r.rows[1].sweep, 50, 1e-9, 'sweep');
    near(r.rows[1].toPrincipals, 0, 1e-9, 'kept');
    assert.equal(r.payoffIndex, 1);
  });
  test('a 50% sweep leaves half the post-tax cash with the principals', () => {
    const h = shareholderLoan({ fcf: [-100, 120], taxable: [0, 80] },
      { share: 0.5, rate: 0, compounding: 1, sweepPct: 0.5, taxRate: 0.25, fee: 0 });
    near(h.rows[1].sweep, 25, 1e-9, 'half sweep');
    near(h.rows[1].toPrincipals, 25, 1e-9, 'kept');
    near(h.endingBalance, 25, 1e-9, 'still owed');
    assert.equal(h.payoffIndex, null);
  });
  test('losses carry forward against later taxable income', () => {
    const c = shareholderLoan({ fcf: [0, 0, 100], taxable: [-40, 0, 100] },
      { share: 0.5, rate: 0, compounding: 1, sweepPct: 1, taxRate: 0.5, fee: 0 });
    // share of taxable: -20, 0, 50 -> taxed 30 at 50% = 15 in year 2.
    near(c.rows[2].taxRelease, 15, 1e-9, 'tax after carry-forward');
  });
  test('deductible interest reduces the tax released', () => {
    const base = { fcf: [-100, 200], taxable: [0, 200] };
    const ded = shareholderLoan(base, { share: 0.5, rate: 0.2, compounding: 1, sweepPct: 1, taxRate: 0.3, fee: 0, interestDeductible: true });
    const non = shareholderLoan(base, { share: 0.5, rate: 0.2, compounding: 1, sweepPct: 1, taxRate: 0.3, fee: 0, interestDeductible: false });
    near(non.rows[1].taxRelease, 30, 1e-9, 'non-deductible tax');
    // Year-0 interest is a loss carried forward, so both years' interest shields year 1.
    near(non.rows[1].taxRelease - ded.rows[1].taxRelease,
      0.3 * (ded.rows[0].interest + ded.rows[1].interest), 1e-9, 'shield');
  });
  test('tax due with no cash to pay it is drawn on the loan', () => {
    const s = shareholderLoan({ fcf: [-10], taxable: [40] },
      { share: 0.5, rate: 0, compounding: 1, sweepPct: 1, taxRate: 0.25, fee: 0 });
    near(s.rows[0].draw, 5 + 5, 1e-9, 'funding plus tax shortfall');
  });
});

describe('shareholderLoan: third-party fee', () => {
  test('arrangement fee is capitalised on each draw', () => {
    const r = shareholderLoan({ fcf: [-200], taxable: [0] },
      { share: 0.5, rate: 0, compounding: 1, sweepPct: 1, taxRate: 0, fee: 0.02 });
    near(r.rows[0].fee, 2, 1e-9, 'fee');
    near(r.rows[0].closing, 102, 1e-9, 'closing');
    near(r.rows[0].lenderCF, -100, 1e-9, 'fee is not cash out');
  });
});

describe('selfFunded', () => {
  test('principals put in their share and pay their own tax', () => {
    const s = selfFunded({ fcf: [-200, 300], taxable: [0, 100] }, { share: 0.5, taxRate: 0.2 });
    assert.deepEqual(s.cash, [-100, 140]);
  });
});

describe('compareFinancing', () => {
  const fcf = [-400, -200, 150, 250, 300, 300, 250, 200, 150, 100];
  const capex = [400, 250, 50, 0, 0, 0, 0, 0, 0, 0];
  const cmp = compareFinancing({ fcf, capex }, { ...DEAL_DEFAULTS, taxRate: 0.25 }, 0.10);

  test('a cheaper third-party loan costs less interest and is repaid no later', () => {
    assert.ok(cmp.thirdParty.totalInterest < cmp.partner.totalInterest);
    assert.ok(cmp.thirdParty.payoffIndex !== null);
    assert.ok(cmp.partner.payoffIndex === null || cmp.thirdParty.payoffIndex <= cmp.partner.payoffIndex);
    assert.ok(cmp.benefit.npv > 0, 'principals gain from cheaper debt');
    near(cmp.benefit.interestSaved, cmp.partner.totalInterest - cmp.thirdParty.totalInterest, 1e-9, 'saved');
  });
  test('partner cash is its equity share plus its loan cash', () => {
    for (let i = 0; i < fcf.length; i++)
      near(cmp.partnerCash[i], 0.65 * fcf[i] + cmp.partner.rows[i].lenderCF, 1e-9, `partner y${i}`);
  });
  test('principals NPV deducts any balance still owed at the horizon', () => {
    const cash = cmp.partner.rows.map((r) => r.toPrincipals);
    const pv = npvMid(cash, 0.10) - cmp.partner.endingBalance / Math.pow(1.10, fcf.length);
    near(cmp.partner.principalsNPV, pv, 1e-9, 'principals NPV');
  });
  test('rejects mismatched arrays', () => {
    assert.throws(() => compareFinancing({ fcf: [1, 2], capex: [1] }, DEAL_DEFAULTS, 0.1), DealError);
  });
});
