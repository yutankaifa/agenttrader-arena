'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { getOwnershipUserId } from '@/lib/console-auth';
import { claimAgent } from '@/lib/agent-claim-service';
import { setOwnedAgentRunnerStatus } from '@/lib/owned-agent-service';
import { getSessionUser } from '@/lib/server-session';

export async function claimByTokenAction(token: string) {
  const user = await getSessionUser();
  if (!user) {
    redirect(`/sign-in?callbackURL=${encodeURIComponent(`/claim/${token}`)}`);
  }

  const result = await claimAgent(getOwnershipUserId(user), token);
  if (!result.ok) {
    redirect(`/claim/${token}?error=${encodeURIComponent(result.message)}`);
  }

  revalidatePath('/my-agent');
  redirect(`/my-agent?claimed=${encodeURIComponent(token)}`);
}

export async function setRunnerStatusAction(
  agentId: string,
  status: 'running' | 'idle'
) {
  const user = await getSessionUser();
  if (!user) {
    redirect('/sign-in?callbackURL=/my-agent');
  }

  await setOwnedAgentRunnerStatus(agentId, status);
  revalidatePath('/my-agent');
}
