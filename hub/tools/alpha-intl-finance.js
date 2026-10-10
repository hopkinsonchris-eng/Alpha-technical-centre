/* Alpha International shareholder financing.
 *
 * Alpha International is owned by a funding partner (Tennor Global, 65%) and
 * the principals (35%). When the company needs cash, the partner funds its own
 * share as equity and may lend the principals their share at a compounding
 * rate (20%). The loan is repaid by sweeping the principals' share of free
 * cash flow, after a tax release that lets them pay tax on income they are
 * allocated but do not keep.
 *
 * Each year, for the principals' share s = share x project free cash flow:
 *   1. Interest accrues on the opening balance for the year, and on any draw
 *      for half a year (mid-year draw, matching the page's mid-year NPV).
 *   2. If s < 0 the shortfall is drawn on the loan (plus any arrangement fee,
 *      capitalised).
 *   3. Tax release: tax = rate x (share x taxable profit - deductible
 *      interest), after losses carried forward. It is paid first from s; any
 *      tax the principals cannot cover from s is drawn on the loan.
 *      With taxRelease off (Heads of Terms s.9 as signed: every Alpha
 *      Distribution goes to the lender while a loan is outstanding) nothing is
 *      released: the sweep takes s before tax and the principals pay the tax
 *      from their own pocket, which can leave their cash negative.
 *   4. Sweep: sweepPct of what is left repays the loan, interest first, and
 *      the rest is the principals' to keep.
 *
 * Two company types (entity):
 *   ccorp  Alpha International as a Texas C-corp (the default). The company
 *          pays US corporate tax on pre-tax profit (free cash flow + capex -
 *          straight-line depreciation + host income tax), after losses carried
 *          forward, less a credit for host income tax (same year, no carry-over,
 *          never below zero). Texas levies no corporate income tax; its small
 *          franchise (margin) tax is ignored. What is left is distributed, and
 *          the principals are taxed on the dividends paid, at the dividend rate
 *          held directly or the holding-company rate (default 5%, the US-UK
 *          treaty rate for a UK company holding 10% or more). Interest on the
 *          principals' loan is not set against dividend tax.
 *   llc    A pass-through LLC: no company tax; the principals are taxed on
 *          their share of profit whether or not it is paid out.
 * Host-government fiscal take is already inside free cash flow.
 *
 * Money in $MM, one entry per year, year index 0 first.
 */

export const DEAL_DEFAULTS = Object.freeze({
  partnerName: 'Tennor',
  partnerShare: 0.65,          // the principals hold 1 - partnerShare
  partnerRate: 0.20,
  partnerCompounding: 1,       // periods per year
  sweepPct: 1,                 // share of post-tax principal cash swept
  entity: 'ccorp',             // 'ccorp' (Texas C-corp) or 'llc' (pass-through)
  corpTaxRate: 0.21,           // US federal corporate income tax (C-corp)
  dividendTaxRate: 0.238,      // qualified dividends 20% + 3.8% NIIT, held directly (C-corp)
  taxRate: 0.25,               // tax on allocated profit, held directly (LLC)
  holdco: true,                // principals hold through holding companies
  holdcoTaxRate: 0.05,         // US-UK treaty withholding on dividends to a UK company holding 10%+
  deprYears: 5,                // straight-line tax depreciation of capex
  interestDeductible: true,
  taxRelease: true,            // pay principals' tax before the sweep
  thirdPartyRate: 0.09,
  thirdPartyCompounding: 1,
  thirdPartyFee: 0.015,        // arrangement fee on each draw, capitalised
});

export class DealError extends Error {
  constructor(message) { super(message); this.name = 'DealError'; }
}

const finite = (v, what) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new DealError(`${what} must be a finite number`);
  return v;
};

/** Annual rate equivalent to a nominal rate compounded n times a year. */
export function effectiveAnnualRate(nominal, periodsPerYear = 1) {
  finite(nominal, 'rate');
  if (nominal < 0) throw new DealError('rate cannot be negative');
  const n = Math.max(1, Math.round(periodsPerYear || 1));
  return n === 1 ? nominal : Math.pow(1 + nominal / n, n) - 1;
}

/** Mid-year discounted sum, the convention used across the financial model. */
export function npvMid(cfs, r) {
  let s = 0;
  for (let i = 0; i < cfs.length; i++) s += cfs[i] / Math.pow(1 + r, i + 0.5);
  return s;
}

/** Project taxable profit: free cash flow + capex - straight-line depreciation. */
export function taxableSeries(fcf, capex, deprYears) {
  if (fcf.length !== capex.length) throw new DealError('fcf and capex must be the same length');
  const n = fcf.length, life = Math.max(1, Math.round(deprYears || 1));
  const dep = new Array(n).fill(0);
  for (let i = 0; i < n; i++)
    for (let k = i; k < Math.min(n, i + life); k++) dep[k] += capex[i] / life;
  return fcf.map((v, i) => v + capex[i] - dep[i]);
}

/** US corporate tax by year: losses carried forward, host income tax credited. */
export function corporateTax(fcf, capex, hostTax, deprYears, rate) {
  const taxable = taxableSeries(fcf, capex, deprYears);
  let lossCF = 0;
  return taxable.map((t, i) => {
    const ti = t + (hostTax[i] || 0) - lossCF;
    if (ti < 0) { lossCF = -ti; return 0; }
    lossCF = 0;
    return Math.max(0, rate * ti - (hostTax[i] || 0));
  });
}

/** Roll the principals' loan forward year by year. */
export function shareholderLoan({ fcf, taxable }, opts) {
  if (!Array.isArray(fcf) || !Array.isArray(taxable) || fcf.length !== taxable.length)
    throw new DealError('fcf and taxable must be arrays of the same length');
  const share = finite(opts.share, 'share');
  const r = effectiveAnnualRate(opts.rate, opts.compounding);
  const halfYr = Math.sqrt(1 + r) - 1;
  const sweepPct = Math.min(1, Math.max(0, opts.sweepPct ?? 1));
  const taxRate = Math.max(0, opts.taxRate ?? 0);
  const feePct = Math.max(0, opts.fee ?? 0);
  const deductible = opts.interestDeductible !== false;
  const release = opts.taxRelease !== false;

  let bal = 0, lossCF = 0, peak = 0, drawn = 0, totInt = 0, totFee = 0, totPaid = 0, totTax = 0;
  let payoffIndex = null, everDrawn = false;
  const rows = [];
  for (let i = 0; i < fcf.length; i++) {
    const s = share * fcf[i];
    const opening = bal;
    let draw = s < 0 ? -s : 0;
    let fee = draw * feePct;
    const interest = opening * r + (draw + fee) * halfYr;

    // Tax release on the principals' allocated profit.
    let ti = share * taxable[i] - (deductible ? interest : 0) - lossCF;
    let tax = 0;
    if (ti < 0) { lossCF = -ti; } else { lossCF = 0; tax = ti * taxRate; }
    const cash = Math.max(0, s);
    const taxRelease = release ? Math.min(cash, tax) : 0;
    const taxShort = release ? tax - taxRelease : 0; // drawn at year end, no interest this year
    draw += taxShort;
    const shortFee = taxShort * feePct;
    fee += shortFee;

    const owed = opening + interest + draw + fee;
    const postTax = cash - taxRelease;
    const sweep = Math.min(postTax * sweepPct, owed);
    const interestPaid = Math.min(sweep, interest);
    const closing = owed - sweep;
    const toPrincipals = postTax - sweep - (release ? 0 : tax); // without a release, tax comes from the principals' pocket

    if (draw > 0) everDrawn = true;
    peak = Math.max(peak, owed);
    drawn += draw; totInt += interest; totFee += fee; totPaid += sweep; totTax += tax;
    if (everDrawn && closing <= 1e-9 && opening + draw > 0 && payoffIndex === null) payoffIndex = i;
    if (closing > 1e-9) payoffIndex = null;          // re-borrowing reopens the loan
    bal = closing <= 1e-9 ? 0 : closing;

    rows.push({ i, share: s, opening, draw, fee, interest, taxRelease, tax, sweep,
      interestPaid, principalPaid: sweep - interestPaid, closing: bal, toPrincipals,
      lenderCF: sweep - draw });
  }
  if (!everDrawn) payoffIndex = null;
  return { rows, peakBalance: peak, totalDrawn: drawn, totalInterest: totInt, totalFees: totFee,
    totalRepaid: totPaid, totalTax: totTax, endingBalance: bal, payoffIndex, rate: r };
}

/** The principals fund their own share and pay their own tax. */
export function selfFunded({ fcf, taxable }, { share, taxRate = 0 }) {
  let lossCF = 0;
  const cash = fcf.map((v, i) => {
    let ti = share * taxable[i] - lossCF, tax = 0;
    if (ti < 0) lossCF = -ti; else { lossCF = 0; tax = ti * taxRate; }
    return share * v - tax;
  });
  return { cash };
}

/** Partner loan versus third-party loan versus self-funding, for one cash flow. */
export function compareFinancing({ fcf: projectFcf, capex, hostTax }, deal, disc) {
  if (!Array.isArray(projectFcf) || !Array.isArray(capex) || projectFcf.length !== capex.length)
    throw new DealError('fcf and capex must be arrays of the same length');
  const d = { ...DEAL_DEFAULTS, ...deal };
  const share = 1 - d.partnerShare;
  const ccorp = d.entity !== 'llc';
  const host = Array.isArray(hostTax) ? hostTax : projectFcf.map(() => 0);
  const corpTax = ccorp ? corporateTax(projectFcf, capex, host, d.deprYears, d.corpTaxRate) : projectFcf.map(() => 0);
  const fcf = projectFcf.map((v, i) => v - corpTax[i]);   // cash the company can distribute
  const taxRate = d.holdco ? d.holdcoTaxRate : (ccorp ? d.dividendTaxRate : d.taxRate);
  // C-corp: shareholders are taxed on dividends paid; LLC: on their share of profit.
  const taxable = ccorp ? fcf.map((v) => Math.max(0, v)) : taxableSeries(fcf, capex, d.deprYears);
  const common = { share, sweepPct: d.sweepPct, taxRate, taxRelease: d.taxRelease,
    interestDeductible: ccorp ? false : d.interestDeductible };
  const n = fcf.length;
  const settle = (loan) => {
    const cash = loan.rows.map((x) => x.toPrincipals);
    loan.principalsCash = cash;
    loan.principalsNPV = npvMid(cash, disc) - loan.endingBalance / Math.pow(1 + disc, n);
    return loan;
  };
  const partner = settle(shareholderLoan({ fcf, taxable },
    { ...common, rate: d.partnerRate, compounding: d.partnerCompounding, fee: 0 }));
  const thirdParty = settle(shareholderLoan({ fcf, taxable },
    { ...common, rate: d.thirdPartyRate, compounding: d.thirdPartyCompounding, fee: d.thirdPartyFee }));
  const self = selfFunded({ fcf, taxable }, { share, taxRate });
  self.principalsNPV = npvMid(self.cash, disc);

  const partnerCash = fcf.map((v, i) => d.partnerShare * v + partner.rows[i].lenderCF);
  const partnerEquityOnly = fcf.map((v) => d.partnerShare * v);
  return {
    share, taxRate, taxable, corpTax, companyFcf: fcf, partner, thirdParty, self, partnerCash,
    partnerNPV: npvMid(partnerCash, disc),
    partnerLoanNPV: npvMid(partner.rows.map((x) => x.lenderCF), disc) + partner.endingBalance / Math.pow(1 + disc, n),
    partnerEquityNPV: npvMid(partnerEquityOnly, disc),
    benefit: {
      npv: thirdParty.principalsNPV - partner.principalsNPV,
      interestSaved: partner.totalInterest - thirdParty.totalInterest,
      costSaved: (partner.totalInterest + partner.totalFees) - (thirdParty.totalInterest + thirdParty.totalFees),
      yearsEarlier: (partner.payoffIndex === null || thirdParty.payoffIndex === null)
        ? null : partner.payoffIndex - thirdParty.payoffIndex,
    },
  };
}
