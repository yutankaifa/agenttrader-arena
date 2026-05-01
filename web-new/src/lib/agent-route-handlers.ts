type AgentServiceErrorResult = {
  ok: false;
  code: string;
  message: string;
  status: number;
  details?: unknown;
};

type AgentServiceSuccessResult<T> = {
  ok: true;
  data: T;
};

type AgentServiceResult<T> = AgentServiceErrorResult | AgentServiceSuccessResult<T>;

type ClaimedAgentResult =
  | {
      ok: true;
      state: {
        agentId: string;
      };
    }
  | {
      ok: false;
      response: Response;
    };

type AuthenticatedAgentResult =
  | {
      ok: true;
      agentId: string;
    }
  | {
      ok: false;
      response: Response;
    };

type AgentErrorResponder = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
  status?: number
) => Response;

function normalizeAgentErrorDetails(
  result: AgentServiceErrorResult
): Record<string, unknown> | undefined {
  return result.details && typeof result.details === 'object'
    ? (result.details as Record<string, unknown>)
    : undefined;
}

export async function handleAgentDecisionPost<T>(
  request: Request,
  deps: {
    requireDatabaseModeApi: (featureName: string) => Response | null;
    requireClaimedActiveAgent: (request: Request) => Promise<ClaimedAgentResult>;
    submitDecision: (
      agentId: string,
      body: unknown
    ) => Promise<AgentServiceResult<T>>;
    agentError: AgentErrorResponder;
    agentSuccess: (data: T) => Response;
  }
) {
  try {
    const unavailable = deps.requireDatabaseModeApi('Agent runtime API');
    if (unavailable) return unavailable;

    const stateResult = await deps.requireClaimedActiveAgent(request);
    if (!stateResult.ok) return stateResult.response;

    const body = await request.json().catch(() => null);
    const result = await deps.submitDecision(stateResult.state.agentId, body);
    if (!result.ok) {
      return deps.agentError(
        result.code,
        result.message,
        normalizeAgentErrorDetails(result),
        result.status
      );
    }

    return deps.agentSuccess(result.data);
  } catch (error) {
    console.error('[agent/decisions] error', error);
    return deps.agentError(
      'INTERNAL_ERROR',
      'Decision submission failed',
      undefined,
      500
    );
  }
}

export async function handleAgentDetailRequestPost<T>(
  request: Request,
  deps: {
    requireDatabaseModeApi: (featureName: string) => Response | null;
    authenticateAgentRequest: (
      request: Request
    ) => Promise<AuthenticatedAgentResult>;
    submitDetailRequest: (
      agentId: string,
      body: unknown
    ) => Promise<AgentServiceResult<T>>;
    agentError: AgentErrorResponder;
    agentSuccess: (data: T) => Response;
  }
) {
  try {
    const unavailable = deps.requireDatabaseModeApi('Agent runtime API');
    if (unavailable) return unavailable;

    const authResult = await deps.authenticateAgentRequest(request);
    if (!authResult.ok) return authResult.response;

    const body = await request.json().catch(() => null);
    const result = await deps.submitDetailRequest(authResult.agentId, body);
    if (!result.ok) {
      return deps.agentError(
        result.code,
        result.message,
        normalizeAgentErrorDetails(result),
        result.status
      );
    }

    return deps.agentSuccess(result.data);
  } catch (error) {
    console.error('[agent/detail-request] error', error);
    return deps.agentError(
      'INTERNAL_ERROR',
      'Detail request failed',
      undefined,
      500
    );
  }
}
