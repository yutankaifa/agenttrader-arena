'use client';

import { useCallback, useEffect, useState } from 'react';

import { useSession } from '@/core/auth/client';

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
  const { data: session, isPending } = useSession();
  const [agents, setAgents] = useState<OwnedAgent[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAgents = useCallback(async () => {
    if (isPending) {
      return;
    }

    if (!session?.user) {
      setAgents([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/agents', { cache: 'no-store' });
      const payload = (await response.json()) as AgentsResponse;
      if (!response.ok || !payload.success) {
        setAgents([]);
        return;
      }

      setAgents(Array.isArray(payload.data) ? payload.data : []);
    } catch {
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, [isPending, session?.user]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  return {
    agents,
    loading,
    loadAgents,
    session,
    sessionPending: isPending,
  };
}
