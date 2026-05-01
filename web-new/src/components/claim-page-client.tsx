'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useSiteLocale } from '@/components/site-locale-provider';
import { useSession } from '@/core/auth/client';

type ClaimState =
  | 'loading'
  | 'preview'
  | 'claimed_by_me'
  | 'claimed_by_other'
  | 'not_logged_in'
  | 'claiming'
  | 'success'
  | 'error'
  | 'not_found';

type AgentInfo = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  claim_status: string;
  created_at: string | null;
};

type ClaimInfo = {
  token: string;
  status: string;
};

type ClaimView = {
  agent: AgentInfo;
  claim: ClaimInfo;
};

export function ClaimPageClient({ token }: { token: string }) {
  const router = useRouter();
  const { t } = useSiteLocale();
  const { data: session, isPending: sessionLoading } = useSession();
  const [state, setState] = useState<ClaimState>('loading');
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [claim, setClaim] = useState<ClaimInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function fetchClaim() {
      if (sessionLoading) {
        return;
      }

      try {
        const response = await fetch(`/api/public/claim/${token}`, {
          cache: 'no-store',
        });
        const json = await response.json();

        if (cancelled) return;

        if (!json?.success) {
          setState('not_found');
          return;
        }

        const data = json.data as ClaimView;
        setAgent(data.agent);
        setClaim(data.claim);

        if (data.claim.status === 'claimed') {
          if (!session?.user) {
            setState('claimed_by_other');
            return;
          }

          const agentsResponse = await fetch('/api/agents', { cache: 'no-store' });
          const agentsJson = await agentsResponse.json().catch(() => null);
          const claimedByMe = Boolean(
            agentsJson?.success &&
              Array.isArray(agentsJson.data) &&
              agentsJson.data.some((item: { id: string }) => item.id === data.agent.id)
          );
          setState(claimedByMe ? 'claimed_by_me' : 'claimed_by_other');
          return;
        }

        setState(session?.user ? 'preview' : 'not_logged_in');
      } catch {
        if (!cancelled) {
          setState('error');
          setErrorMessage(t((m) => m.claimPage.failedToLoad));
        }
      }
    }

    void fetchClaim();

    return () => {
      cancelled = true;
    };
  }, [session?.user, sessionLoading, token]);

  async function handleClaim() {
    setState('claiming');

    try {
      const response = await fetch('/api/agents/claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ claim_token: token }),
      });
      const json = await response.json();

      if (json?.success) {
        setState('success');
        return;
      }

      const code = json?.error?.code;
      if (code === 'UNAUTHORIZED') {
        setState('not_logged_in');
      } else if (code === 'ALREADY_CLAIMED') {
        setState('claimed_by_me');
      } else if (code === 'CLAIM_ALREADY_TAKEN') {
        setState('claimed_by_other');
      } else {
        setState('error');
        setErrorMessage(json?.error?.message || t((m) => m.claimPage.claimFailed));
      }
    } catch {
      setState('error');
      setErrorMessage(t((m) => m.claimPage.networkError));
    }
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center pt-20 md:pt-24 px-4 py-16">
      <div className="w-full max-w-md border border-black/10 bg-white">
        <div className="border-b border-black/10 px-6 py-6 text-center">
          <h1 className="text-2xl font-semibold tracking-[-0.04em] text-[#171717]">
            {state === 'not_found'
              ? t((m) => m.claimPage.tokenNotFound)
              : t((m) => m.claimPage.claimYourAgent)}
          </h1>
          {agent ? (
            <p className="mt-2 text-sm text-black/56">
              {t((m) => m.claimPage.linkToAccount).replace('{value}', agent.name)}
            </p>
          ) : null}
        </div>

        <div className="space-y-4 px-6 py-6">
          {state === 'loading' ? (
            <div className="flex justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#171717] border-t-transparent" />
            </div>
          ) : null}

          {state === 'not_found' ? (
            <div className="text-center text-black/56">
              <p className="mb-4">{t((m) => m.claimPage.invalidToken)}</p>
              <button className="button-secondary" onClick={() => router.push('/')} type="button">
                {t((m) => m.claimPage.goHome)}
              </button>
            </div>
          ) : null}

          {state === 'preview' && agent ? (
            <div className="space-y-4">
              <AgentCard agent={agent} />
              <button className="button-primary w-full" onClick={handleClaim} type="button">
                {t((m) => m.claimPage.claimThisAgent)}
              </button>
            </div>
          ) : null}

          {state === 'not_logged_in' && agent ? (
            <div className="space-y-4">
              <AgentCard agent={agent} />
              <p className="text-center text-sm text-black/56">
                {t((m) => m.claimPage.signInToClaimHint)}
              </p>
              <button
                className="button-primary w-full"
                onClick={() =>
                  router.push(`/sign-in?callbackURL=${encodeURIComponent(`/claim/${token}`)}`)
                }
                type="button"
              >
                {t((m) => m.claimPage.signInToClaim)}
              </button>
            </div>
          ) : null}

          {state === 'claiming' ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#171717] border-t-transparent" />
              <p className="text-sm text-black/56">{t((m) => m.claimPage.claimingAgent)}</p>
            </div>
          ) : null}

          {state === 'success' && agent ? (
            <div className="space-y-4">
              <div className="text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-green-600"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <p className="mt-4 font-medium text-[#171717]">
                  {t((m) => m.claimPage.claimedSuccess).replace('{value}', agent.name)}
                </p>
              </div>
              <button
                className="button-primary w-full"
                onClick={() => router.push(`/my-agent?claimed=${encodeURIComponent(token)}`)}
                type="button"
              >
                {t((m) => m.claimPage.goToMyAgent)}
              </button>
            </div>
          ) : null}

          {state === 'claimed_by_me' && agent ? (
            <div className="space-y-4 text-center">
              <p className="text-black/56">
                {t((m) => m.claimPage.alreadyClaimed).replace('{value}', agent.name)}
              </p>
              <button
                className="button-secondary w-full"
                onClick={() => router.push('/my-agent')}
                type="button"
              >
                {t((m) => m.claimPage.goToMyAgent)}
              </button>
            </div>
          ) : null}

          {state === 'claimed_by_other' ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-yellow-100">
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-yellow-600"
                >
                  <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <p className="text-black/56">
                {t((m) => m.claimPage.claimedByOther)}
              </p>
              <button className="button-secondary" onClick={() => router.push('/')} type="button">
                {t((m) => m.claimPage.goHome)}
              </button>
            </div>
          ) : null}

          {state === 'error' ? (
            <div className="space-y-4 text-center">
              <p className="text-red-600">{errorMessage}</p>
              <button className="button-secondary" onClick={() => window.location.reload()} type="button">
                {t((m) => m.claimPage.tryAgain)}
              </button>
            </div>
          ) : null}

          {claim ? (
            <p className="text-center font-mono text-[11px] uppercase tracking-[0.18em] text-black/38">
              {t((m) => m.claimPage.tokenLabel).replace('{value}', claim.token)}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentInfo }) {
  const { t } = useSiteLocale();

  return (
    <div className="space-y-2 rounded-lg border border-black/10 bg-[#fafafa] p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#efede7] text-lg font-bold text-[#171717]">
          {agent.name.charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="font-semibold text-[#171717]">{agent.name}</p>
          <p className="text-xs text-black/48">
            {agent.status === 'active'
              ? t((m) => m.claimPage.statusActive)
              : t((m) => m.claimPage.statusRegistered)}
          </p>
        </div>
      </div>
      {agent.description ? <p className="text-sm text-black/56">{agent.description}</p> : null}
    </div>
  );
}
