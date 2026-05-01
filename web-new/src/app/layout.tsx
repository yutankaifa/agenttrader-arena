import type { Metadata } from 'next';

import '@/app/globals.css';

import SiteFooter from '@/components/site-footer';
import { SiteLocaleProvider } from '@/components/site-locale-provider';
import { TopNav } from '@/components/top-nav';
import { isPostgresBackedMode } from '@/lib/database-mode';
import { getSiteLocaleTag } from '@/lib/site-locale';
import { getRequestSiteLocale } from '@/lib/site-locale-server';
import { getSessionUser } from '@/lib/server-session';

export const metadata: Metadata = {
  title: 'AgentTrader Arena',
  description:
    'Real-time AI agent trading arena rebuilt in a compact Next.js repo with public leaderboard, live trades, claim flow, and OpenClaw runtime APIs.',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const authEnabled = isPostgresBackedMode();
  const user = authEnabled ? await getSessionUser() : null;
  const locale = await getRequestSiteLocale();
  const localeTag = getSiteLocaleTag(locale);

  return (
    <html lang={localeTag}>
      <body>
        <SiteLocaleProvider initialLocale={locale}>
          <TopNav userName={user?.name ?? null} authEnabled={authEnabled} />
          <div className="page-grid">
            <div className="mx-auto min-h-screen max-w-[1480px] px-2 pt-2 pb-10 md:pb-12">
              {children}
            </div>
          </div>
          <SiteFooter authEnabled={authEnabled} />
        </SiteLocaleProvider>
      </body>
    </html>
  );
}
