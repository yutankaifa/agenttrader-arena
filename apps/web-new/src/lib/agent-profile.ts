const VALID_MARKETS = ['stock', 'crypto', 'prediction'] as const;
const VALID_RISK_PREFERENCES = [
  'conservative',
  'balanced',
  'aggressive',
] as const;

type ValidMarket = (typeof VALID_MARKETS)[number];
type ValidRiskPreference = (typeof VALID_RISK_PREFERENCES)[number];

type RawAgentProfileInput = {
  model_provider?: unknown;
  model_name?: unknown;
  runtime_environment?: unknown;
  primary_market?: unknown;
  familiar_symbols_or_event_types?: unknown;
  strategy_style?: unknown;
  strategy_hint?: unknown;
  risk_preference?: unknown;
  market_preferences?: unknown;
};

export type NormalizedAgentProfile = {
  modelProvider: string;
  modelName: string;
  runtimeEnvironment: string;
  primaryMarket: ValidMarket;
  familiarSymbolsOrEventTypes: string[];
  strategyStyle: string;
  riskPreference: ValidRiskPreference;
  marketPreferences: ValidMarket[];
};

export function validateAgentProfileInput(
  input: RawAgentProfileInput,
  prefix = 'profile'
):
  | { ok: true; value: NormalizedAgentProfile }
  | { ok: false; message: string; details?: Record<string, unknown> } {
  const modelProvider = normalizeRequiredString(
    input.model_provider,
    `${prefix}.model_provider`
  );
  if (!modelProvider.ok) return modelProvider;

  const modelName = normalizeRequiredString(
    input.model_name,
    `${prefix}.model_name`
  );
  if (!modelName.ok) return modelName;

  const runtimeEnvironment = normalizeRequiredString(
    input.runtime_environment,
    `${prefix}.runtime_environment`
  );
  if (!runtimeEnvironment.ok) return runtimeEnvironment;

  const primaryMarket = normalizeRequiredMarket(
    input.primary_market,
    `${prefix}.primary_market`
  );
  if (!primaryMarket.ok) return primaryMarket;

  const familiar = normalizeRequiredStringArray(
    input.familiar_symbols_or_event_types,
    `${prefix}.familiar_symbols_or_event_types`
  );
  if (!familiar.ok) return familiar;

  const strategyValue =
    typeof input.strategy_style === 'string'
      ? input.strategy_style
      : input.strategy_hint;
  const strategyStyle = normalizeRequiredString(
    strategyValue,
    `${prefix}.strategy_style`
  );
  if (!strategyStyle.ok) return strategyStyle;

  const riskPreference = normalizeRequiredRiskPreference(
    input.risk_preference,
    `${prefix}.risk_preference`
  );
  if (!riskPreference.ok) return riskPreference;

  const marketPreferences = normalizeMarketPreferences(
    input.market_preferences,
    primaryMarket.value
  );
  if (!marketPreferences.ok) return marketPreferences;

  return {
    ok: true,
    value: {
      modelProvider: modelProvider.value,
      modelName: modelName.value,
      runtimeEnvironment: runtimeEnvironment.value,
      primaryMarket: primaryMarket.value,
      familiarSymbolsOrEventTypes: familiar.value,
      strategyStyle: strategyStyle.value,
      riskPreference: riskPreference.value,
      marketPreferences: marketPreferences.value,
    },
  };
}

export function getMissingAgentProfileFields(agent: {
  modelProvider?: string | null;
  modelName?: string | null;
  runtimeEnvironment?: string | null;
  primaryMarket?: string | null;
  familiarSymbolsOrEventTypes?: string[] | null;
  strategyHint?: string | null;
  riskPreference?: string | null;
}) {
  const missing: string[] = [];
  if (!agent.modelProvider?.trim()) missing.push('model_provider');
  if (!agent.modelName?.trim()) missing.push('model_name');
  if (!agent.runtimeEnvironment?.trim()) missing.push('runtime_environment');
  if (!agent.primaryMarket?.trim()) missing.push('primary_market');
  if (!agent.familiarSymbolsOrEventTypes?.length) {
    missing.push('familiar_symbols_or_event_types');
  }
  if (!agent.strategyHint?.trim()) missing.push('strategy_style');
  if (!agent.riskPreference?.trim()) missing.push('risk_preference');
  return missing;
}

export function isAgentProfileComplete(agent: {
  modelProvider?: string | null;
  modelName?: string | null;
  runtimeEnvironment?: string | null;
  primaryMarket?: string | null;
  familiarSymbolsOrEventTypes?: string[] | null;
  strategyHint?: string | null;
  riskPreference?: string | null;
}) {
  return getMissingAgentProfileFields(agent).length === 0;
}

function normalizeRequiredString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false as const, message: `${field} is required` };
  }
  return { ok: true as const, value: value.trim() };
}

function normalizeRequiredMarket(value: unknown, field: string) {
  if (typeof value !== 'string') {
    return { ok: false as const, message: `${field} is required` };
  }
  const normalized = value.trim().toLowerCase();
  if (!VALID_MARKETS.includes(normalized as ValidMarket)) {
    return {
      ok: false as const,
      message: `${field} must be one of: ${VALID_MARKETS.join(', ')}`,
    };
  }
  return { ok: true as const, value: normalized as ValidMarket };
}

function normalizeRequiredRiskPreference(value: unknown, field: string) {
  if (typeof value !== 'string') {
    return { ok: false as const, message: `${field} is required` };
  }
  const normalized = value.trim().toLowerCase();
  if (!VALID_RISK_PREFERENCES.includes(normalized as ValidRiskPreference)) {
    return {
      ok: false as const,
      message: `${field} must be one of: ${VALID_RISK_PREFERENCES.join(', ')}`,
    };
  }
  return { ok: true as const, value: normalized as ValidRiskPreference };
}

function normalizeRequiredStringArray(value: unknown, field: string) {
  if (!Array.isArray(value)) {
    return { ok: false as const, message: `${field} must be a non-empty array` };
  }
  const normalized = Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
  if (!normalized.length) {
    return { ok: false as const, message: `${field} must include at least 1 item` };
  }
  return { ok: true as const, value: normalized };
}

function normalizeMarketPreferences(value: unknown, primaryMarket: ValidMarket) {
  if (!value) {
    return { ok: true as const, value: [primaryMarket] };
  }

  const list = Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().toLowerCase())
    : typeof value === 'string'
      ? value
          .split(/[|,/]/)
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean)
      : null;

  if (!list) {
    return {
      ok: false as const,
      message: 'market_preferences must be an array or comma-separated string',
    };
  }

  const normalized = Array.from(
    new Set(
      list.filter((item): item is ValidMarket => VALID_MARKETS.includes(item as ValidMarket))
    )
  );
  if (!normalized.length) {
    return {
      ok: false as const,
      message: `market_preferences must be one of: ${VALID_MARKETS.join(', ')}`,
    };
  }

  if (!normalized.includes(primaryMarket)) {
    normalized.unshift(primaryMarket);
  }

  return { ok: true as const, value: normalized };
}
