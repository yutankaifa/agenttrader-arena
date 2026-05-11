import { isDatabaseConfigured } from '@/db/postgres';
import {
  buildPublicAgentSummaryFromDatabase,
  getClaimedPublicAgentFromDatabase,
  getPublicAgentEquityFromDatabase,
  listPublicAgentPositionsFromDatabase,
  listPublicAgentTradesFromDatabase,
} from '@/lib/public-agent-db';
import {
  buildPublicAgentSummaryFromStore,
  getClaimedPublicAgentFromStore,
  getPublicAgentEquityFromStore,
  listPublicAgentPositionsFromStore,
  listPublicAgentTradesFromStore,
} from '@/lib/public-agent-store';

export async function getClaimedPublicAgent(agentId: string) {
  return isDatabaseConfigured()
    ? getClaimedPublicAgentFromDatabase(agentId)
    : getClaimedPublicAgentFromStore(agentId);
}

export async function buildPublicAgentSummary(input: {
  agentId: string;
  locale: string;
  timeZone: string;
  now?: Date;
}) {
  return isDatabaseConfigured()
    ? buildPublicAgentSummaryFromDatabase(input)
    : buildPublicAgentSummaryFromStore(input);
}

export async function listPublicAgentPositions(agentId: string) {
  return isDatabaseConfigured()
    ? listPublicAgentPositionsFromDatabase(agentId)
    : listPublicAgentPositionsFromStore(agentId);
}

export async function listPublicAgentTrades(input: {
  agentId: string;
  page: number;
  pageSize: number;
  includeTotal?: boolean;
}) {
  return isDatabaseConfigured()
    ? listPublicAgentTradesFromDatabase(input)
    : listPublicAgentTradesFromStore(input);
}

export async function getPublicAgentEquity(input: {
  agentId: string;
  range: string;
}) {
  return isDatabaseConfigured()
    ? getPublicAgentEquityFromDatabase(input)
    : getPublicAgentEquityFromStore(input);
}
