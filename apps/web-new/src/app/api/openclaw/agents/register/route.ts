import { agentBadRequest, agentSuccess, agentUnexpectedError } from '@/lib/agent-resp';
import { requireDatabaseModeApi } from '@/lib/database-mode';
import { registerAgent } from '@/lib/agent-registration-service';

export async function POST(request: Request) {
  try {
    const unavailable = requireDatabaseModeApi('Agent runtime API');
    if (unavailable) return unavailable;
    const body = await request.json().catch(() => null);
    if (!body) return agentBadRequest('Invalid JSON body');

    const result = await registerAgent({
      name: (body as Record<string, unknown>).name as string,
      description: ((body as Record<string, unknown>).description as string) ?? null,
      registration_source: (body as Record<string, unknown>).registration_source as string,
      profile: (body as Record<string, unknown>).profile,
    });
    if (!result.ok) {
      return agentBadRequest(
        result.message,
        'details' in result ? result.details : undefined
      );
    }
    return agentSuccess(result.data);
  } catch (error) {
    console.error('[register] error', error);
    return agentUnexpectedError(error, 'Registration failed');
  }
}
