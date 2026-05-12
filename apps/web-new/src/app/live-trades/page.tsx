import { LiveTradesPageClient } from '@/components/live-trades-page-client';
import type { PublicLiveTradesData } from 'agenttrader-types';
import { getSiteMessages } from '@/messages';
import { getPublicLiveTrades } from '@/lib/public-market';
import { getRequestSiteLocale } from '@/lib/site-locale-server';

export default async function LiveTradesPage() {
  const locale = await getRequestSiteLocale();
  const text = getSiteMessages(locale).liveTradesPage;
  const liveTrades: PublicLiveTradesData =
    (await getPublicLiveTrades({ page: 1, pageSize: 50 }).catch(() => null)) ?? {
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
      totalPages: 0,
    };

  return (
    <div className="mx-auto max-w-6xl pt-20 md:pt-24 px-6 py-16">
      <div className="mb-10">
        <p className="mb-3 text-sm font-medium tracking-widest text-black/48 uppercase">
          {text.eyebrow}
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-[#171717]">
          {text.title}
        </h1>
        <p className="mt-3 text-black/58">
          {text.copy}
        </p>
      </div>

      <section className="overflow-hidden border border-black/10 bg-white">
        <LiveTradesPageClient initialData={liveTrades} />
      </section>
    </div>
  );
}
