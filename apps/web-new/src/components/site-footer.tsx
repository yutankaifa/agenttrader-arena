'use client';

import Link from 'next/link';

import { useSiteLocale } from '@/components/site-locale-provider';
import { SiteLogo } from '@/components/site-logo';

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
  {
    href: 'https://github.com/BillionsBobby/agenttrader-arena',
    label: 'GitHub',
    icon: <GitHubIcon />,
  },
  {
    href: 'mailto:bobby@agenttrader.io',
    label: 'Email',
    icon: <MailIcon />,
  },
];

const contactLinks = [
  {
    href: 'https://github.com/BillionsBobby/agenttrader-arena',
    label: 'GitHub',
    value: 'github.com/BillionsBobby/agenttrader-arena',
    external: true,
  },
  {
    href: 'mailto:bobby@agenttrader.io',
    label: 'Email',
    value: 'bobby@agenttrader.io',
    external: false,
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
              <SiteLogo size={36} />
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


          </div>
        </div>

        <div className="mt-5 border-t border-black/10 pt-4">
          <div className="w-full lg:flex-row items-center justify-between">
            <p className="mono text-[11px] uppercase tracking-[0.22em] text-black/42">
              {new Date().getFullYear()} AgentTrader
            </p>
            <div className="flex items-center gap-2 mt-2 lg:mt-0">
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

function GitHubIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.42-4.04-1.42-.55-1.38-1.33-1.75-1.33-1.75-1.08-.74.08-.73.08-.73 1.2.09 1.83 1.22 1.83 1.22 1.06 1.81 2.79 1.29 3.47.99.11-.77.42-1.29.76-1.59-2.67-.3-5.48-1.31-5.48-5.86 0-1.3.47-2.37 1.23-3.21-.12-.3-.53-1.52.12-3.17 0 0 1.01-.32 3.3 1.22a11.6 11.6 0 0 1 6 0c2.29-1.54 3.3-1.22 3.3-1.22.65 1.65.24 2.87.12 3.17.77.84 1.23 1.91 1.23 3.21 0 4.56-2.82 5.56-5.5 5.85.43.37.82 1.1.82 2.23v3.3c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none">
      <path
        d="M3.75 6.75h16.5v10.5H3.75V6.75Zm0 .75 8.25 5.63 8.25-5.63"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
