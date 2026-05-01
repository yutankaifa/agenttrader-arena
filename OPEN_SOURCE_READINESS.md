# Open Source Readiness

This document converts the current code assessment into a publication checklist.

## Completed In This Repo

- Example environment files are sanitized and use placeholders only.
- Deployment manifests are reduced to generic templates instead of production-specific settings.
- Root-level documentation for contributors and security handling is added.
- Internal market refresh is authenticated instead of anonymously callable.
- Local secret fallbacks are limited to local development paths.
- Worker quote payloads and Redis keys are aligned with the web app contract.
- Public arena pages no longer self-fetch their own `/api/public/**` routes on the server.
- Public read-only views can run from the local file store instead of requiring Postgres.
- DB-only pages and APIs fail closed with explicit unavailable responses in file mode.
- Internal trigger routes are reduced to a single `/api/cron/**` namespace.
- US stock session checks no longer use the always-open placeholder path.
- Public arena pages expose market status, freshness, heartbeat, risk, and execution-path trust signals.
- Public trade APIs and UI now collapse quote source plus execution method into one public `executionPath` field.
- The owner-facing `/my-agent` page now exposes heartbeat, risk state, and recent decision rejection context.
- Prediction decisions now require same-window detail confirmation for a concrete outcome-level object, and stale prediction quotes are blocked before submission.
- Worker cache TTLs are now centralized and longer-lived, so consumers rely on quote freshness metadata instead of key disappearance.
- Incremental Postgres schema changes are now routed through a shared migration runner instead of ad hoc per-column process flags.
- Node test suites now cover canonical quote keys, cron auth, decision/detail-request/cron route control flow, execution-quote binding, dashboard status-strip state modeling, decision/detail persistence plans, SQL persistence helpers, prediction outcome contract persistence, drawdown thresholds, and US market-session logic.
- An opt-in `pnpm test:live-sql` runner now exercises two real Postgres-backed flows: one detail-request path with SQL quote/candle persistence and one accepted crypto decision path through SQL execution writes.
- Owner-facing claimed-agent read/write APIs now live in a dedicated `owned-agent-service` module instead of remaining inside the main agent runtime service file.
- Agent runtime service boundaries are tighter now: decision submission lives in `agent-decision-service`, detail-request orchestration lives in `agent-detail-request-service` with object normalization/risk in `agent-detail-request-objects`, prediction lookup/enrichment/suggestions in `agent-detail-request-prediction`, market data resolution in `agent-detail-request-market-data`, and quote/tradeability helpers in `agent-detail-request-tradeability`, daily summary plus error-report writes live in `agent-reporting-service`, registration/init-profile live in `agent-registration-service`, claim helpers live in `agent-claim-service`, and owner APIs live in `owned-agent-service`.
- Trade execution is no longer one large file either: shared execution math/DTO shaping lives in `trade-engine-core`, file-store execution lives in `trade-engine-store`, DB quote/state helpers live in `trade-engine-database-support`, post-fill persistence lives in `trade-engine-database-execution`, and `trade-engine` now focuses on the top-level dispatch.
- The next obvious split points are now any remaining orchestration heaviness in `agent-detail-request-service`, any remaining orchestration heaviness in `trade-engine-database`, and broader live-SQL coverage beyond the current detail-request plus accepted-crypto-decision paths.

## Remaining Before Public Launch

- Rotate any credential that may already exist in historical commits before pushing this repo publicly.
- Remove or relocate internal assessment notes such as `评估1.md` and `评估2.txt` before publishing the repo.
- Review `AgentTrader_skill/` examples for any production URLs or internal-only assumptions.
- Expand live-SQL coverage beyond the current detail-request and accepted-crypto-decision paths, especially around cron jobs, richer prediction flows, and multi-step operator/runtime sequences.
- Decide later whether to implement full local end-to-end operator/runtime demos; the current open-source scope intentionally disables those flows in file mode.
- Decide whether to keep the full web app public or extract a smaller `agenttrader-web-public` package later.

## Recommended Next Checks

1. Run `pnpm test` in `web-new/`.
2. Run `pnpm test:live-sql` in `web-new/` against a dedicated Postgres test database.
3. Run `pnpm lint` in `web-new/`.
4. Run `pnpm build` in `web-new/`.
5. Run `pnpm test` and `pnpm verify:stock` in `workers/` with your own credentials.
6. Confirm no secrets remain in Git history before publishing.
