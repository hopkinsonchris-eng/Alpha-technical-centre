# Changelog

All notable changes to Opportunity Register are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semantic versioning. Versions before the registry existed were derived from git history.

## [Unreleased]

## [2.1.2] - 2026-09-23

### Changed
- Page pins its calculator imports with a ?v token (now derived from tool.json). (d8a4835)

## [2.1.1] - 2026-09-23

### Fixed
- Never show a calculated figure as zero when it was not calculated. (6793367)

## [2.1.0] - 2026-09-23

### Added
- Seed a starting model from the play analogue so the uplift is never blank. (bbb50b2)

## [2.0.0] - 2026-09-23

### Added
- Technical potential is now computed (js/potential.js, js/analogues.js) and the bridge is shown. (3f68b41)

### Changed
- BREAKING: figures come from the calculator rather than typed estimates, so earlier records are not comparable. (3f68b41)

## [1.1.1] - 2026-09-23

### Fixed
- Staff portal returns people to the tool they asked for after sign-in. (fe72a4f)

## [1.1.0] - 2026-09-23

### Added
- Venezuela opportunities shown on the map. (5d7c56f)

## [1.0.0] - 2026-09-23

### Added
- Global Opportunity Register added to the staff area. (5e2b80c)
