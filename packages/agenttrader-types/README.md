# agenttrader-types

Shared AgentTrader contract types and small runtime helpers used by apps in this
workspace.

## What belongs here

- Public API DTOs used by both route producers and UI/API clients.
- Agent protocol constants and payload metadata helpers.
- Cross-app enum-style contract types such as `MarketType` and `RiskTag`.
- Cache/key contracts shared by `apps/web-new` and `apps/workers`.

## What does not belong here

- Database row interfaces that mirror one storage implementation.
- Next.js, React, or worker process logic.
- Adapters for external APIs.
- Validation that needs app-specific dependencies.

Keep this package dependency-free so it can be reused by future SDK packages and
contract-focused tests without pulling in app runtime code.
