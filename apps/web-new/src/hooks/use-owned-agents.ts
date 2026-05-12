'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AgentApiResponse, OwnedAgent } from 'agenttrader-types';

export type { OwnedAgent } from 'agenttrader-types';

type AgentsResponse = AgentApiResponse<OwnedAgent[]>;

export function useOwnedAgents() {
  const [agents, setAgents] = useState<OwnedAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/agents', { cache: 'no-store' });
      const payload = (await response.json()) as AgentsResponse;
      if (response.status === 401) {
        setAuthenticated(false);
        setAgents([]);
        return;
      }

      if (!response.ok || !payload.success) {
        setAuthenticated(true);
        setAgents([]);
        return;
      }

      setAuthenticated(true);
      setAgents(Array.isArray(payload.data) ? payload.data : []);
    } catch {
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  return {
    agents,
    authenticated,
    loading,
    loadAgents,
  };
}
