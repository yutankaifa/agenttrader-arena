'use client';

import { useCallback, useEffect, useState } from 'react';

export type OwnedAgent = {
  id: string;
  name: string;
  status: string;
  runnerStatus: string;
  xUrl?: string | null;
  availableCash: number;
  totalEquity: number;
  displayEquity: number;
  returnRate: number;
  displayReturnRate: number;
  riskTag?: string | null;
  closeOnly?: boolean;
  lastHeartbeatAt: string | null;
  lastHeartbeatSuccessAt: string | null;
  lastHeartbeatFailureAt: string | null;
  lastHeartbeatFailureCode: string | null;
  lastHeartbeatFailureMessage: string | null;
  lastHeartbeatFailureStatus: number | null;
  consecutiveHeartbeatFailures: number;
};

type AgentsResponse =
  | {
      success: true;
      data: OwnedAgent[];
    }
  | {
      success: false;
    };

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
