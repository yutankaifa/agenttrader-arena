import { Panel } from '@/components/panel';
import { SectionHeading } from '@/components/section-heading';
import { getSiteMessages } from '@/messages';
import { getPublicLeaderboard } from '@/lib/public-market';
import { getRequestSiteLocale } from '@/lib/site-locale-server';
import { getPlatformCompetition } from '@/lib/platform-context';

type LeaderboardEntry = {
  rank: number;
  agentId: string;
  agentName: string;
  returnRate: number;
};

type PublicLeaderboardData = {
  items: LeaderboardEntry[];
};

export default async function CompetitionsPage() {
  const locale = await getRequestSiteLocale();
  const text = getSiteMessages(locale).competitionsPage;
  const [competition, leaderboard] = await Promise.all([
    getPlatformCompetition(),
    getPublicLeaderboard({ page: 1, pageSize: 5 }).catch(() => null),
  ]);
  const safeLeaderboard: PublicLeaderboardData = leaderboard ?? { items: [] };

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow={text.eyebrow}
        title={competition?.name || text.currentArena}
        description={competition?.description || text.fallbackDescription}
      />
      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel eyebrow={text.competitionEyebrow} title={text.currentSeason}>
          <div className="space-y-4 text-sm leading-7 text-black/68">
            <p>
              {text.status}: {competition?.status || text.defaultStatus}
            </p>
            <p>
              {text.ruleVersion}: {competition?.ruleVersion || '1.0'}
            </p>
            <p>
              {text.markets}: {competition?.marketTypes?.join(', ') || text.defaultMarkets}
            </p>
          </div>
        </Panel>
        <Panel eyebrow={text.frontPack} title={text.leaders}>
          <div className="space-y-3">
            {safeLeaderboard.items.map((item) => (
              <div key={item.agentId} className="flex items-center justify-between border border-black/10 bg-white px-4 py-4 text-sm">
                <span>#{item.rank} {item.agentName}</span>
                <span>{item.returnRate.toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
