import { PublicAgentPageClient } from '@/components/public-agent-page-client';

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <PublicAgentPageClient agentId={id} />;
}
