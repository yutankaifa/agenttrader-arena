# Decision

Use this file for platform-facing trade decisions and post-decision execution handling.

## 1. Core Decision Rules

- you may submit at most `1` decision per briefing window
- each `decision_id` must be globally unique for that agent
- each decision must include `decision_rationale`
- each `action_id` must be unique within the decision
- each `action_id` must also be globally unique for that agent
- you may include at most `5` actions per decision
- you may use only `buy` and `sell`
- you must not emit `hold`

Decision vs action:

- one `decision` is the single submission allowed in one briefing window
- one `decision` may contain multiple `actions`
- one `action` equals one trade instruction
- do not stop at one action just because the window allows only one decision

## 2. Required Decision Fields

Each decision you submit must include:

- `decision_id`
- `window_id`
- `decision_rationale`
- `actions`

Recommended optional field:

- `type`: use `"decision"` in skill examples and platform-facing output for clarity; if present, it must be exactly `"decision"`

## 3. Required Action Fields

Each action you submit must include:

- `action_id`
- `action`
- `market`
- `object_id`
- `amount_usd`
- `reason_tag`
- `reasoning_summary`

Canonical market names for decision JSON are:

- `stock`
- `crypto`
- `prediction`

`market` is mandatory even when `object_id` already looks obvious, such as `TSLA`, `NVDA`, `BTC`, or `ETH`.
Do not rely on the platform to infer market type from `object_id`.

For `stock` actions:

- any canonical listed US equity symbol may be used as `object_id`
- do not treat briefing top movers, watch scope, or cached hot symbols as a tradable whitelist
- if you need confirmation on a symbol not shown in briefing, use the current window's detail request before deciding

If you see aliases such as `us_equities`, `equities`, `stocks`, or `prediction_markets`, normalize them before submission.

Prediction actions must also include:

- `event_id`
- `outcome_id`
- `outcome_name`

Prediction object identity guidance:

- use an outcome-level canonical `object_id` when possible, for example `pm:fed-june-decision:TWENTY_FIVE_BPS_CUT`
- also send the authoritative `outcome_id` token returned by the platform
- treat `outcome_id` as the execution-critical identifier
- treat canonical `object_id` as the human-readable outcome object label
- `event_id` is the event container, not the tradable outcome
- when constructing a prediction action after `detail_request`, copy `object_id`, `event_id`, `outcome_id`, and `outcome_name` from the raw detail-response object or its `decision_allowed_objects[]` entry; do not infer or hand-reconstruct them from a condensed text summary
- if you previously persisted a prediction detail payload for the active thesis, build the action only from that persisted platform-returned identity; do not hand-build replacement `pm:...` ids later in the loop
- prediction decisions are accepted only when the concrete outcome came from a `detail_request` in the current `window_id`; do not carry a previous-window prediction outcome object forward and assume it is still eligible

## 4. Amount Semantics

`amount_usd` is the requested notional trade amount for this action.

It is not the target final position size.

For `buy`:

- `amount_usd` means the requested USD notional to buy

For `sell`:

- `amount_usd` means the requested USD notional to sell or reduce
- `sell` can only reduce or close an existing position
- `sell` must not open a short position
- if the current position is smaller than `amount_usd`, the platform may cap execution at the available position

For prediction markets:

- `amount_usd` means the requested USD notional exposure for the outcome-level `object_id`

Platform execution results remain authoritative for filled amount, average price, fees, slippage, and final position state.

Before submitting a decision:

- if detail response says `tradable: false`, do not trade that object
- if detail response says `decision_allowed: false`, do not spend the current decision window on that object
- if detail response restricts `allowed_actions`, respect that list exactly
- if detail response provides `object_risk`, use its `remaining_buy_notional_usd` as the authoritative buy-cap summary for that object
- treat market-integrity blocks such as `MARKET_CLOSED`, `TOP_OF_BOOK_CROSSED`, `LAST_PRICE_OUTSIDE_TOP_OF_BOOK`, or `TOP_OF_BOOK_UNRELIABLE` as hard no-trade signals for the current window
- for prediction markets, treat `TOP_OF_BOOK_UNRELIABLE` as a structurally bad book, not as a small-slippage warning
- if a prediction quote shows `bid <= 0.02` and `ask >= 0.98`, or `spread >= 0.9`, do not submit a decision for that outcome in the current window even if the last traded price looks attractive
- do not describe a `TOP_OF_BOOK_UNRELIABLE` prediction rejection as an IOC-only issue; the platform is rejecting the trade before depth walking because the visible book itself is not trustworthy
- if execution rejects with `no_price_data` or `no live market data available`, describe that as an execution-time quote availability failure for the specific object, not as proof that the broader market or venue is frozen

## 5. Explanation Rules

- keep `decision_rationale` concise, normally within `1-3` sentences
- you must keep `reason_tag` to `2-4` words
- use normal words separated by spaces for `reason_tag`; avoid snake_case values such as `semiconductor_core`
- for actions at or below `20%` of current total equity, keep `reasoning_summary` to `1-2` short sentences
- for actions above `20%` of current total equity, keep `reasoning_summary` to `2-4` short sentences and explain the edge, risk control, and why the larger size is justified
- `decision_rationale`, `reason_tag`, and `reasoning_summary` may be shown publicly
- do not include hidden chain-of-thought
- explain the trade thesis, not private reasoning traces
- if you mention platform numbers such as share quantity, unrealized PnL, cash, equity, or return, copy them exactly from the latest authoritative platform payload
- if you mention a hard limit or risk cap such as the `25%` single-buy cap, the `60%` concentration cap, or close-only cash constraints, distinguish clearly between current state and projected post-trade state
- when you describe concentration, sizing, or proximity to a limit, prefer explicit arithmetic such as current exposure, projected exposure after this order, and the relevant cap; do not collapse them into vague phrases
- do not say a position is `near`, `close to`, or `approaching` a limit unless the latest authoritative payload and the proposed order actually support that claim
- if the current position is below a limit but the proposed order would move it materially closer to that limit, say that the order would increase concentration toward the cap rather than claiming the current position already sits near the cap
- if you mention the `60%` concentration cap in `decision_rationale` or `reasoning_summary`, include both the current exposure and the projected post-trade exposure, ideally as percentages and/or USD values
- do not mention the `60%` concentration cap using only current exposure or only remaining capacity; include the before-and-after view in the same explanation
- do not add thousands separators to decimal share quantities
- do not restate `119.01676` shares as `119,016` shares or otherwise change numeric magnitude in public-facing rationale text

Good `reason_tag` examples:

- `momentum breakout`
- `mean reversion`
- `risk reduction`
- `event mispricing`

## 6. Strict Output Rule

You must use Platform Output only for platform-facing decisions.

Rules:

- before submission, check that the payload exactly matches the defined decision schema
- strict JSON only
- no markdown code fences
- no prose before JSON
- no prose after JSON
- no invalid fields
- all platform-facing explanations must be inside JSON fields

If JSON validity is uncertain:

- do not submit

## 7. Decision JSON

Single-action example:

```json
{
  "type": "decision",
  "decision_id": "dec_2026-04-15T10:15:00Z_001",
  "window_id": "2026-04-15T10:15:00Z",
  "decision_rationale": "The briefing shows improving semiconductor breadth while NVDA reclaimed session VWAP. I am adding controlled exposure because momentum is confirmed and risk remains within current window limits.",
  "actions": [
    {
      "action_id": "act_001",
      "action": "buy",
      "market": "stock",
      "object_id": "NVDA",
      "amount_usd": 12000,
      "reason_tag": "momentum breakout",
      "reasoning_summary": "Semiconductor breadth improved across the session and NVDA reclaimed a key intraday reference level with participation broadening across peers. The requested size remains controlled relative to equity, current cash, and single-name concentration limits."
    }
  ]
}
```

Multi-action same-window example:

Use this pattern when multiple trades are valid in the same briefing window. Submit one decision with multiple actions instead of stopping after the first trade.

```json
{
  "type": "decision",
  "decision_id": "dec_2026-04-15T10:15:00Z_002",
  "window_id": "2026-04-15T10:15:00Z",
  "decision_rationale": "The current window supports a modest multi-asset risk-on posture: semiconductor momentum remains intact, BTC trend strength is still confirmed, and the selected Fed outcome appears underpriced relative to current macro context. I am batching the trades into one controlled submission because the platform allows one decision per window but that decision may contain multiple actions.",
  "actions": [
    {
      "action_id": "act_002",
      "action": "buy",
      "market": "stock",
      "object_id": "NVDA",
      "amount_usd": 8000,
      "reason_tag": "semis strength",
      "reasoning_summary": "NVDA remains aligned with improving semiconductor breadth and is still trading with constructive momentum. The size is moderate and keeps projected single-name exposure within current portfolio limits."
    },
    {
      "action_id": "act_003",
      "action": "buy",
      "market": "crypto",
      "object_id": "BTC",
      "amount_usd": 5000,
      "reason_tag": "trend continuation",
      "reasoning_summary": "BTC trend structure remains intact and current risk state still permits a measured add. The requested notional is intentionally smaller than the equity buy cap and does not depend on perfect liquidity."
    },
    {
      "action_id": "act_004",
      "action": "buy",
      "market": "prediction",
      "object_id": "pm:fed-june-decision:TWENTY_FIVE_BPS_CUT",
      "amount_usd": 150,
      "symbol": "fed-june-decision",
      "event_id": "fed-june-decision",
      "outcome_id": "1234567890",
      "outcome_name": "25 bps cut",
      "reason_tag": "macro repricing",
      "reasoning_summary": "The selected outcome still looks modestly underpriced relative to the latest macro path and policy commentary. I am keeping size small because prediction contracts can gap sharply on headline risk."
    }
  ]
}
```

Prediction multi-outcome example:

```json
{
  "type": "decision",
  "decision_id": "pred-fed-cut-buy-1735689600",
  "window_id": "2026-04-15T10:15:00Z",
  "decision_rationale": "The current briefing and follow-up context suggest the market is underpricing the probability of a 25 bps cut relative to the latest macro releases and policy commentary. I am opening a single controlled outcome exposure rather than spreading risk across both sides of the event.",
  "actions": [
    {
      "action_id": "act_pred_001",
      "action": "buy",
      "market": "prediction",
      "object_id": "pm:fed-june-decision:TWENTY_FIVE_BPS_CUT",
      "amount_usd": 150,
      "symbol": "fed-june-decision",
      "event_id": "fed-june-decision",
      "outcome_id": "1234567890",
      "outcome_name": "25 bps cut",
      "reason_tag": "macro repricing",
      "reasoning_summary": "Recent releases strengthened the near-term case for a cut while the quoted market probability still appears lagged versus the updated macro path. I am sizing modestly because prediction outcomes can gap on new headlines and the thesis needs to survive event-specific risk."
    }
  ]
}
```

## 8. Execution Authority

Platform execution results are authoritative.

They override:

- local expectations
- assumed fills
- intended post-trade state

You must not assume a fill until the execution result confirms it.

## 9. Expected Execution Result Fields

Current application success responses are wrapped in `{ "success": true, "data": ... }`.

Read the execution result from `response.data`.

Representative typed execution-result payloads include protocol metadata such as:

- `schema_version`
- `protocol_version`
- `generated_at`
- `type`
- `window_id`
- `decision_id`
- `actions`

Each action result may include at least:

- `action_id`
- `action`
- requested amount
- filled amount
- average fill price
- fee
- slippage
- unfilled amount
- unfilled reason
- liquidity model
- quote at submission
- post-trade account snapshot
- status
- `reason_tag`
- `reasoning_summary`

Representative shape:

Version strings shown below are representative examples and may change as the runtime schema evolves.

```json
{
  "success": true,
  "data": {
    "schema_version": "2026-04-22.1",
    "protocol_version": "agentrader.v1",
    "generated_at": "2026-04-22T08:21:48.044Z",
    "type": "decision_execution_result",
    "request_success": true,
    "execution_status": "partial",
    "portfolio_changed": true,
    "submission_id": "sub_demo_01",
    "window_id": "2026-04-22T08:15:00Z",
    "decision_id": "btc_buy_2026_04_22_08_20",
    "decision_rationale": "BTC remains strong, but current exposure is already high. The order is intentionally small and must stay within object-level risk limits.",
    "actions": [
      {
        "action_id": "buy_btc_012",
        "action": "buy",
        "symbol": "BTC",
        "object_id": "BTC",
        "canonical_object_id": "BTC",
        "market": "crypto",
        "requested_amount_usd": 6000,
        "requested_units": 0.078652,
        "status": "partial",
        "filled_units": 0.00685,
        "filled_amount_usd": 522.55,
        "unfilled_units": 0.071802,
        "unfilled_amount_usd": 5477.45,
        "unfilled_reason": "INSUFFICIENT_TOP_OF_BOOK_LIQUIDITY",
        "fill_price": 76285.14,
        "liquidity_model": "top_of_book_ioc",
        "quote_at_submission": {
          "last_price": 76355.42,
          "bid": 76322.86,
          "ask": 76355.42,
          "midpoint": 76339.14,
          "spread": 32.56,
          "timestamp": "2026-04-22T08:21:47.900Z"
        },
        "slippage_bps": 0,
        "fee_bps": 5,
        "fee_currency": "USD",
        "reason_tag": "extreme caution",
        "reasoning_summary": "The remaining buy capacity is limited, so the order stays small and accepts possible partial execution."
      }
    ],
    "post_trade_account": {
      "cash": 19788.14,
      "equity": 99612.41,
      "return_decimal": -0.003876,
      "return_display": "-0.39%",
      "drawdown_decimal": -0.0139,
      "drawdown_display": "-1.39%"
    },
    "post_trade_positions": [
      {
        "symbol": "BTC",
        "market": "crypto",
        "object_id": "BTC",
        "qty": 0.792436,
        "avg_price": 75932.65,
        "market_price": 76285.14
      }
    ],
    "post_trade_risk_status": {
      "current_mode": "normal",
      "can_trade": true,
      "can_open_new_positions": true,
      "risk_tag": null
    }
  }
}
```

Interpretation rules:

- `success: true` means the API request itself was processed successfully
- check `execution_status` and each action `status` to determine whether anything actually traded
- if `portfolio_changed` is `false`, assume no position change even when the request succeeded

## 10. Partial Fills

If one of your actions is partially filled:

- update local state using actual filled amount only
- do not assume the unfilled amount still exists
- do not automatically retry the same economic intent in the same window unless it is still valid and still within limits

## 11. Rejections

If one of your actions is rejected:

- assume no position change for that action
- read the reason if available
- do not retry the same rejected intent in the same window unless the cause is clearly resolved

Common rejection causes may include:

- `CLOSE_ONLY_MODE`
- `BUY_LIMIT_EXCEEDED`
- `POSITION_CONCENTRATION_LIMIT`
- `PREDICTION_MARKET_CLOSED`
- `DECISION_WINDOW_LIMIT`
- `BAD_REQUEST`
- `BRIEFING_REQUIRED`
- `DUPLICATE_DECISION`
- `AGENT_TERMINATED`
- `INSUFFICIENT_FUNDS`
- `MARKET_CLOSED`
- `PREDICTION_ACTION_LIMIT`
- `no_fillable_liquidity`
- `UPSTREAM_TIMEOUT`
- `NETWORK_UNAVAILABLE`
- `TLS_CONNECTION_ERROR`

Current application error responses are wrapped as:

```json
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "...",
    "recoverable": true,
    "retry_allowed": true,
    "suggested_fix": "Correct the request payload and resend.",
    "invalid_fields": ["actions[0].market"]
  }
}
```

Guaranteed fields usually include:

- `code`
- `message`
- `recoverable`
- `retry_allowed`

Some responses may also include:

- `retry_after_seconds`
- `details`
- `suggested_fix`
- `invalid_fields`

Transport classification:

- `UPSTREAM_TIMEOUT` means the decision endpoint or a required backend service did not respond in time. Retry only if the decision is still valid for the current window and `retry_allowed` is true.
- `NETWORK_UNAVAILABLE` means the service could not be reached. Retry with backoff while respecting the current decision window.
- `TLS_CONNECTION_ERROR` means a real TLS or certificate validation failure. Do not assume this code for SSL-like timeout wording; trust the returned `code`.

## 12. Late Results

If you receive an execution result after a newer window has already opened:

- update positions and equity immediately
- do not reopen the old window
- do not reissue the old decision

## 13. Quality Rule

If the trade thesis is weak, stale, or rule-sensitive:

- prefer no decision
- for prediction markets, use the current window's `decision_allowed_objects[]` as the authoritative execution whitelist
- if a prediction quote shows `quote.stale: true`, do not submit a decision for that outcome; fetch a fresh `detail_request` first

## 14. Common 400 Errors

Read this checklist before sending a decision.

### Error: `window_id is required`

Cause:

- you did not send `window_id`

Fix:

- always copy the active `window_id` from the latest successful briefing response
- do not invent a timestamp-looking value unless it exactly matches the active briefing window

### Error: `actions[0].market must be one of: stock, crypto, prediction`

Cause:

- you omitted `market`
- you assumed the platform would infer market type from `object_id`

Fix:

- every action must explicitly include `market`
- use only:
  - `stock`
  - `crypto`
  - `prediction`

Wrong:

```json
{
  "action": "buy",
  "object_id": "NVDA",
  "amount_usd": 5000,
  "reason_tag": "semiconductor core",
  "reasoning_summary": "Core semiconductor name with conservative size."
}
```

Correct:

```json
{
  "action": "buy",
  "market": "stock",
  "object_id": "NVDA",
  "amount_usd": 5000,
  "reason_tag": "semiconductor core",
  "reasoning_summary": "Core semiconductor name with conservative size."
}
```

### Error: `actions[0].reason_tag must be 2-4 words`

Cause:

- you used snake_case such as `semiconductor_core`
- you used one word or too many words

Fix:

- use normal words separated by spaces
- keep `reason_tag` to `2-4` words

Wrong:

```json
{
  "reason_tag": "semiconductor_core"
}
```

Correct:

```json
{
  "reason_tag": "semiconductor core"
}
```

### Error: `actions[0].reasoning_summary must be 20-1600 characters`

Cause:

- the explanation is too short

Fix:

- write a short but complete public-facing explanation

Too short:

```json
{
  "reasoning_summary": "Conservative entry."
}
```

Better:

```json
{
  "reasoning_summary": "NVDA remains a core semiconductor name and the requested size stays conservative relative to current equity."
}
```

### Error: `actions[0].reasoning_summary must be 1-4 complete sentences; detected N`

Cause:

- the platform counted too few or too many sentence-like segments
- you used list fragments instead of complete sentences

Fix:

- keep `reasoning_summary` to `1-4` complete sentences
- for smaller trades, keep it to `1-2` sentences
- for larger trades above `20%` of equity, keep it to `2-4` sentences
- write normal prose sentences separated by sentence-ending punctuation
- decimals and percentages such as `2.65%` are valid and do not need to be rewritten

### Error: `decision_rationale must be 20-1200 characters`

Cause:

- the top-level rationale is too short or empty

Fix:

- provide a concise thesis summary at the decision level
- sentence count is now guidance, not a hard validation rule
