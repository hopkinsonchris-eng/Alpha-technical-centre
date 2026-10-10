# Changelog

All notable changes to Upstream Quick-Look Financial Model are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semantic versioning. Versions before the registry existed were derived from git history.

## [Unreleased]

### Added
- Staff edition, Alpha International tab: a "Release tax before the sweep" switch, on by default. Off follows Heads of Terms §9 as signed: every distribution is swept to the lender while a loan is outstanding, and the principals pay their tax from their own pocket. The setting is saved with runs.
- Staff edition, Alpha International tab: Alpha International is modelled as a Texas C-corp by default. US federal corporate tax (21%, editable) is charged on the company's pre-tax profit, after losses carried forward and less a credit for host income tax. The principals are then taxed on dividends paid. A company-type selector keeps the pass-through LLC treatment. To support the credit, the staff edition's engine rows now carry the contractor's host income tax; the public page is unchanged.
- Staff edition, Alpha International tab: a "Principals hold through a UK holding company" switch, on by default, taxes their dividends at the US–UK treaty rate (5%, editable) instead of 23.8% held directly. The same switch applies to allocated profit in LLC mode. Saved with runs.
- Staff edition at `hub/tools/alpha-international.html` (behind Cloudflare Access, noindex): the public model plus an Alpha International tab. It models the partner-funded principals' loan at a compounding rate, repaid by a cash sweep of the principals' share of free cash flow after a tax release, and compares it with third-party debt and self-funding, by fiscal regime and by project. Deal terms are saved with runs. Engine in `hub/tools/alpha-intl-finance.js`, tested in `test/alpha-intl-finance.test.mjs`. The public page does not carry the tab.

### Fixed
- JV regime took OPEX and CAPEX off the contractor's cash twice: once at its equity share and again in full. JV income tax was also charged in full to the contractor. Now the JV pays royalty, costs and income tax, the contractor takes its equity share of what is left, and the value bridge closes. The 40% default case went from a portfolio NPV of −$1,106MM to +$1,063MM. Other regimes are unchanged.

## [1.0.0] - 2026-07-31

### Added
- Initial upload of the financial model page (page states Version 1.0, June 2026). (ca43b36)
- Google Analytics 4 (gtag.js). (33034ef)

### Changed
- SEO: canonical tags, social cards, structured data. (5e2b92f)
- Unify contact email. (6b9bf39)
- Technical Due Diligence service page cross-links. (7bf455e)

### Fixed
- Phantom /BOE 404 in Search Console. (7bdfb35)
