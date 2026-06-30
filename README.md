# WaitLayer Planning Package

WaitLayer is the working name for a privacy-first reward marketplace for AI wait time and developer attention.

This repository currently contains the planning artifacts requested before implementation. The goal is to validate and design the full marketplace loop before building: developer opt-in, ad display during eligible wait states, impression/click tracking, advertiser billing, ledger-based user earnings, fraud review, and payout.

## Documents

- [Strategy audit](docs/00-strategy-audit.md)
- [Product Requirements Document](docs/01-product-requirements.md)
- [Technical Architecture Document](docs/02-technical-architecture.md)
- [Database Schema](docs/03-database-schema.md)
- [API Specification](docs/04-api-specification.md)
- [MVP Roadmap](docs/05-mvp-roadmap.md)
- [Fraud Prevention Plan](docs/06-fraud-prevention-plan.md)
- [Payout Strategy](docs/07-payout-strategy.md)
- [Compliance and Privacy Checklist](docs/08-compliance-privacy-checklist.md)
- [UI Page List](docs/09-ui-page-list.md)
- [Engineering Task Breakdown](docs/10-engineering-task-breakdown.md)
- [Milestone Checklist](docs/11-milestone-checklist.md)
- [Definition of Done](docs/12-definition-of-done.md)
- [Risk Register](docs/13-risk-register.md)
- [Validation Experiments](docs/14-validation-experiments.md)
- [Sources and Assumptions](docs/15-sources-and-assumptions.md)

## Current Build Rule

Do not start broad implementation until the Phase 0 validation gates pass:

- MVP scope is agreed.
- Privacy and prohibited data rules are frozen for the extension and CLI.
- Ledger invariants are reviewed.
- Fraud checks and payout holds are defined.
- Advertiser demand is validated with interviews or committed test budgets.

