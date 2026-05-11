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

type ProtocolEventWriter = (input: {
  agentId: string;
  endpointKey: 'detail_request' | 'decision';
  httpMethod: 'POST';
  requestId?: string | null;
  decisionId?: string | null;
  briefingWindowId?: string | null;
  statusCode: number;
  requestSuccess: boolean;
  requestPayload?: unknown;
  responsePayload?: unknown;
  createdAt?: Date;
}) => Promise<void>;

function normalizeAgentErrorDetails(
  result: AgentServiceErrorResult
): Record<string, unknown> | undefined {
  return result.details && typeof result.details === 'object'
    ? (result.details as Record<string, unknown>)
    : undefined;
}

function readStringField(
  value: unknown,
  key: 'request_id' | 'decision_id' | 'window_id'
) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' && candidate.trim() ? candidate : null;
}

async function readResponseBody(response: Response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function writeProtocolEventSafely(
  writer: ProtocolEventWriter | undefined,
  input: Parameters<ProtocolEventWriter>[0]
) {
  if (!writer) {
    return;
  }

  try {
    await writer(input);
  } catch {
    // Protocol audit persistence must not break the API response.
  }
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
    writeProtocolEvent?: ProtocolEventWriter;
  }
) {
  let agentId: string | null = null;
  let body: unknown = null;

  try {
    const unavailable = deps.requireDatabaseModeApi('Agent runtime API');
    if (unavailable) return unavailable;

    const stateResult = await deps.requireClaimedActiveAgent(request);
    if (!stateResult.ok) return stateResult.response;
    agentId = stateResult.state.agentId;

    body = await request.json().catch(() => null);
    const result = await deps.submitDecision(agentId, body);
    if (!result.ok) {
      const response = deps.agentError(
        result.code,
        result.message,
        normalizeAgentErrorDetails(result),
        result.status
      );
      await writeProtocolEventSafely(deps.writeProtocolEvent, {
        agentId,
        endpointKey: 'decision',
        httpMethod: 'POST',
        decisionId: readStringField(body, 'decision_id'),
        briefingWindowId:
          readStringField(body, 'window_id') ??
          readStringField(result.details, 'window_id'),
        statusCode: response.status,
        requestSuccess: false,
        requestPayload: body,
        responsePayload: await readResponseBody(response),
      });
      return response;
    }

    const response = deps.agentSuccess(result.data);
    await writeProtocolEventSafely(deps.writeProtocolEvent, {
      agentId,
      endpointKey: 'decision',
      httpMethod: 'POST',
      decisionId:
        readStringField(body, 'decision_id') ??
        readStringField(result.data, 'decision_id'),
      briefingWindowId:
        readStringField(body, 'window_id') ??
        readStringField(result.data, 'window_id'),
      statusCode: response.status,
      requestSuccess: true,
      requestPayload: body,
      responsePayload: await readResponseBody(response),
    });
    return response;
  } catch (error) {
    console.error('[agent/decisions] error', error);
    const response = deps.agentError(
      'INTERNAL_ERROR',
      'Decision submission failed',
      undefined,
      500
    );
    if (agentId) {
      await writeProtocolEventSafely(deps.writeProtocolEvent, {
        agentId,
        endpointKey: 'decision',
        httpMethod: 'POST',
        decisionId: readStringField(body, 'decision_id'),
        briefingWindowId: readStringField(body, 'window_id'),
        statusCode: response.status,
        requestSuccess: false,
        requestPayload: body,
        responsePayload: await readResponseBody(response),
      });
    }
    return response;
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
    writeProtocolEvent?: ProtocolEventWriter;
  }
) {
  let agentId: string | null = null;
  let body: unknown = null;

  try {
    const unavailable = deps.requireDatabaseModeApi('Agent runtime API');
    if (unavailable) return unavailable;

    const authResult = await deps.authenticateAgentRequest(request);
    if (!authResult.ok) return authResult.response;
    agentId = authResult.agentId;

    body = await request.json().catch(() => null);
    const result = await deps.submitDetailRequest(agentId, body);
    if (!result.ok) {
      const response = deps.agentError(
        result.code,
        result.message,
        normalizeAgentErrorDetails(result),
        result.status
      );
      await writeProtocolEventSafely(deps.writeProtocolEvent, {
        agentId,
        endpointKey: 'detail_request',
        httpMethod: 'POST',
        requestId: readStringField(body, 'request_id'),
        briefingWindowId:
          readStringField(body, 'window_id') ??
          readStringField(result.details, 'window_id'),
        statusCode: response.status,
        requestSuccess: false,
        requestPayload: body,
        responsePayload: await readResponseBody(response),
      });
      return response;
    }

    const response = deps.agentSuccess(result.data);
    await writeProtocolEventSafely(deps.writeProtocolEvent, {
      agentId,
      endpointKey: 'detail_request',
      httpMethod: 'POST',
      requestId:
        readStringField(body, 'request_id') ??
        readStringField(result.data, 'request_id'),
      briefingWindowId:
        readStringField(body, 'window_id') ??
        readStringField(result.data, 'window_id'),
      statusCode: response.status,
      requestSuccess: true,
      requestPayload: body,
      responsePayload: await readResponseBody(response),
    });
    return response;
  } catch (error) {
    console.error('[agent/detail-request] error', error);
    const response = deps.agentError(
      'INTERNAL_ERROR',
      'Detail request failed',
      undefined,
      500
    );
    if (agentId) {
      await writeProtocolEventSafely(deps.writeProtocolEvent, {
        agentId,
        endpointKey: 'detail_request',
        httpMethod: 'POST',
        requestId: readStringField(body, 'request_id'),
        briefingWindowId: readStringField(body, 'window_id'),
        statusCode: response.status,
        requestSuccess: false,
        requestPayload: body,
        responsePayload: await readResponseBody(response),
      });
    }
    return response;
  }
}
