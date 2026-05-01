'use client';

import Link from 'next/link';

import { useSiteLocale } from '@/components/site-locale-provider';

const socialLinks = [
  {
    href: 'https://x.com/xillionsbobby',
    label: 'X',
    icon: <XIcon />,
  },
  {
    href: 'https://discord.gg/vVSaekHsYY',
    label: 'Discord',
    icon: <DiscordIcon />,
  },
];

export default function SiteFooter({
  authEnabled,
}: {
  authEnabled: boolean;
}) {
  const { t } = useSiteLocale();
  const navItems = [
    { href: '/leaderboard', label: t((m) => m.footer.leaderboard) },
    { href: '/live-trades', label: t((m) => m.footer.liveTrades) },
    { href: '/join', label: t((m) => m.footer.join) },
    ...(authEnabled
      ? [{ href: '/my-agent', label: t((m) => m.footer.myAgent) }]
      : []),
  ];

  return (
    <footer className="border-t border-black/10 bg-[#f6f5f0]">
      <div className="mx-auto max-w-[1480px] px-4 py-6 md:px-6 md:py-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-md">
            <div className="flex items-center gap-3">
              <span className="mono inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/15 bg-white text-[11px] uppercase tracking-[0.24em] text-[#171717]">
                AT
              </span>
              <div>
                <p className="mono text-[11px] uppercase tracking-[0.24em] text-black/45">
                  AgentTrader
                </p>
                <p className="text-sm font-semibold tracking-[-0.03em] text-[#171717]">
                  {t((m) => m.footer.tagline)}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-5 lg:items-end">
            <nav className="flex flex-wrap gap-x-5 gap-y-2">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-sm text-black/58 transition hover:text-[#171717]"
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            <div className="flex items-center gap-2">
              {socialLinks.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={item.label}
                  title={item.label}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/12 bg-white text-[#171717] transition hover:bg-[#171717] hover:text-white"
                >
                  {item.icon}
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 border-t border-black/10 pt-4">
          <p className="mono text-[11px] uppercase tracking-[0.22em] text-black/42">
            {new Date().getFullYear()} AgentTrader
          </p>
        </div>
      </div>
    </footer>
  );
}

function XIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.9 2H22l-6.77 7.74L23.2 22h-6.26l-4.9-7.41L5.56 22H2.44l7.24-8.28L1.6 2h6.42l4.43 6.71L18.9 2Zm-1.1 18h1.73L7.07 3.9H5.22L17.8 20Z" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.54 5.39a17.1 17.1 0 0 0-4.23-1.31l-.2.4a15.2 15.2 0 0 1 3.96 1.37 13.8 13.8 0 0 0-4.22-1.12 14.9 14.9 0 0 0-5.7 0A13.4 13.4 0 0 0 4.93 5.85a15.1 15.1 0 0 1 3.96-1.37l-.2-.4a17 17 0 0 0-4.23 1.31C1.79 9.37 1.08 13.23 1.43 17.04a17.3 17.3 0 0 0 5.18 2.6l1.12-1.82a11.2 11.2 0 0 1-1.76-.86l.44-.32c3.4 1.6 7.1 1.6 10.46 0l.45.32c-.56.33-1.15.62-1.77.86l1.12 1.82a17.2 17.2 0 0 0 5.18-2.6c.41-4.42-.7-8.24-3.33-11.65ZM9.17 14.7c-1.02 0-1.85-.94-1.85-2.1 0-1.17.82-2.1 1.85-2.1 1.02 0 1.86.94 1.85 2.1 0 1.16-.83 2.1-1.85 2.1Zm5.66 0c-1.02 0-1.85-.94-1.85-2.1 0-1.17.82-2.1 1.85-2.1 1.02 0 1.86.94 1.85 2.1 0 1.16-.82 2.1-1.85 2.1Z" />
    </svg>
  );
}
