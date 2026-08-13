# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.2] - 2026-08-13

### Changed
- Migrated from direct Solr access to the peviitor API (`scraper/api.js` — `https://api.peviitor.ro/v1`)
- Restructured repo to the EPAM template layout: scraping code moved under `scraper/`
- Modernized `scraper/config/company.json` schema (`id`, `company`, `brand`, `status`, `location[]`, `website[]`, `career[]`, `scraperFile`)
- Replaced legacy docs with the template `ai/` documentation layout
- Added `CODE_OF_CONDUCT.md`
- Bumped version to match the EPAM template (1.5.2)

### Added
- `job-deep-validate.yml` workflow (Playwright browser validation of job URLs)
- `automation-template-sync-check.yml` workflow (tracks template version)
- Playwright dev dependency for deep URL validation

### Fixed
- E2E tests no longer fail on intermittent ANOFM timeouts — tests now skip cleanly when the API is unavailable (`itIfAnofm`/`itIfApi`)
- Request timeouts now use `AbortSignal.timeout` instead of the deprecated `timeout` fetch option
- `tests/validate-sobis-solutions-jobs.js` now supports `--head`/`--content`/`--browser`/`--timeout` modes

## [1.0.0] - 2026-07-21

### Added
- Initial release of SOBIS SOLUTIONS S.R.L. scraper (CIF 12018818)
- Job scraping from ANOFM public API (filtered by CIF)
- Company validation via ANAF
- Solr integration for job storage
- GitHub Actions workflows for daily scraping and testing
- Comprehensive test suite (unit, integration, E2E)
- ANAF API fallback with cached data support
- Node 24 compatibility
- Derived from sebiboga/epam-systems-international-srl-nodejs-scraper template

### Features
- Automated daily job scraping from ANOFM API
- Company core validation and management
- Job URL validation
- Data integrity checks
- Romanian location filtering
- Work mode normalization

## License

Copyright (c) 2024-2026 BOGA SEBASTIAN-NICOLAE
Licensed under MIT License
