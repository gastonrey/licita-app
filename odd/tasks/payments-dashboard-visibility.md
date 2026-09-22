# Feature: payments-dashboard-visibility

## Objective
Make payment activity (settled payments, failed payment attempts, checkout initiations, webhook confirmations) the first thing the operator sees, with honest zero states, and fix the stats fields that currently report $0 revenue despite 38 settled payments.

## Problem
Production data (2026-09-22 probe with OPERATOR_KEY) shows: 38 settled x402 payments ($2.81, 1 payer, first 2026-08-17), 186 payment_required 402s, 0 verify_failed/facilitator_unavailable. The dashboard Payments view reads `payments.successes` (=0, only dev 'success' status) and `payments.revenue_usd` (=0) so it renders "$0 / no payments" while settled data sits in `by_status.settled`. Checkout initiations and webhook outcomes are not shown on the Payments tab at all.

## Why
Operator cannot answer "did anyone try to pay?" at a glance. Telemetry exists (request_logs.paymentFailureKind, payments table, /v1/stats/payments feed); presentation and two misnamed/missing aggregate fields hide it.

## Authorized scope
- src/api/routes/stats.ts: payments aggregate block — expose settled count/amount/revenue, distinct payers, per-provider/network checkout counts (checkout_started_total, subscription_activated_total from metrics), failure-kind breakdown (payment_required/verify_failed/facilitator_unavailable), keep existing keys back-compat (add `settled`, don't drop `successes`).
- src/web/dashboard.ts: Payments tab redesign — KPI row (settled revenue, settled payments, distinct payers, failed attempts), reusable funnel (checkout initiated → confirmed → settled), attempt table with reason badges, explicit empty state ("0 payments since deploy <date>") when settled=0.
- Overview alert keeps working; cross-link stays.
- tests in test/ covering stats payload shape + frontend needles.
- No contract changes to public endpoints (operator-only stats are not public surface).

## Constraints
- Strict TDD (RED → GREEN), test runner: `npm test`.
- Preserve request_logs minimization rules (no raw keys, hashed labels only).
- licita-ui design system, token-based, a11y contract, browser verification required.

## Tasks checklist
- [x] T0 Production verification snapshot (read-only curl) — evidence in engram + this doc: 38 settled / $2.81 / 186 payment_required / 0 verify_failed / 1 payer.
- [x] T1 RED tests: stats payments aggregates include settled_revenue_usd, settled_count, payers, failure kinds. → test/unit/stats.payments.aggregate.test.ts
- [x] T2 GREEN stats.ts aggregate changes (back-compat keys kept: attempts/successes/revenue_usd/by_status).
- [x] T3 RED tests: dashboard needles for payments KPI + funnel + empty state. → test/unit/dashboard.payments.test.ts (6 tests)
- [x] T4 GREEN dashboard.ts payments-tab redesign + Overview Revenue KPI settled fix + statusClass badge bug fix (st-4 → real status).
- [x] T5 Full verification: npm test 623/623, typecheck clean, build clean; browser render evidence desktop 1440 + mobile 390 (no horizontal overflow, KPI stack) — payments-tab-desktop-final.png / payments-tab-mobile-390.png.

## Route / delegation
Runtime sub-agent delegation failed twice (upstream transport error) → direct inline route with per-task commits on feature branch. Strict TDD observed: RED first in both test files, then GREEN.

## Commit log
- (branch: feat/payments-dashboard-visibility)
