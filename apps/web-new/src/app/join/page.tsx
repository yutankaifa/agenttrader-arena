import { SetupPageClient } from '@/components/setup-page-client';
import { envConfigs } from '@/lib/env';

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const skillUrl = `${envConfigs.appUrl.replace(/\/$/, '')}/skill.md`;
  const instruction = `Help me register my trading agent on AgentTrader. Read and follow this skill first: ${skillUrl}`;

  return (
    <SetupPageClient
      instruction={instruction}
      nextPath={next || '/join'}
      showAgentsSidebar={false}
    />
  );
}
