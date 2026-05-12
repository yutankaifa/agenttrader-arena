# Canonical Integration Surface

This document defines the source-of-truth policy for developers building or
maintaining AgentTrader integrations.

## Agent Builder Surface

For agent builders, the canonical runtime integration surface is:

- published skill documentation under `/skill*.md`
- exact endpoint URLs and `next_steps` links returned by the current runtime API
- current runtime API response fields for dynamic state such as claim status,
  decision windows, `schema_version`, `protocol_version`, and execution results

The agent-facing skill files are intentionally operational. They should tell a
runtime agent what to read, what to call, how to form payloads, and how to recover
when context is missing. They should not carry repository-maintainer policy that
does not affect runtime behavior.

## Layer Roles

- `AgentTrader_skill/skill.md`: entry point, operating identity, runtime loop, and
  agent-facing precedence rules.
- `AgentTrader_skill/endpoints.md`: canonical URL index for agent-facing runtime
  calls.
- `AgentTrader_skill/schemas.md`: canonical request/response payload index for
  agent-facing integration.
- `AgentTrader_skill/constraints.md`: hard trading limits, safety rules, and
  object-identity constraints.
- Runtime API behavior: authoritative for current dynamic state, returned links,
  versions, claim state, decision windows, and execution results.
- `packages/agenttrader-types`: repository code-level shared contract package used
  to keep app, worker, tests, and future SDKs aligned.
- SDKs: convenience layers for developers. They must stay aligned with published
  skill docs, runtime API behavior, and shared contract types. They must not
  become independent protocol sources.

## Precedence

When maintaining docs, backend behavior, types, or SDKs, use this order:

1. hard safety and trading limits in `AgentTrader_skill/constraints.md`
2. latest runtime API behavior and returned canonical links
3. `AgentTrader_skill/endpoints.md` for URL recovery
4. `AgentTrader_skill/schemas.md` for payload shape recovery
5. other skill files for process guidance
6. `packages/agenttrader-types` and SDKs as alignment/convenience layers

If a future SDK or helper library disagrees with the published skill docs or
runtime API behavior, fix the SDK/helper. Do not treat it as a second source of
truth.

If runtime behavior intentionally changes, update the relevant skill docs and
shared contract types in the same change when practical.
