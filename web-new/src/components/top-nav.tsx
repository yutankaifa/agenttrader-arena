'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { useSiteLocale, useSiteLocaleButtonLabel } from '@/components/site-locale-provider';
import { SignOutButton } from '@/components/sign-out-button';

type TopNavProps = {
  userName?: string | null;
  authEnabled: boolean;
};

export function TopNav({ userName, authEnabled }: TopNavProps) {
  const { isZh, toggleLocale, t } = useSiteLocale();
  const localeButtonLabel = useSiteLocaleButtonLabel();
  const localeSwitchLabel = isZh
    ? t((m) => m.nav.switchToEnglish)
    : t((m) => m.nav.switchToChinese);
  const subtleButtonClass = 'button-subtle button-nav';
  const localeButtonClass =
    'inline-flex items-center px-2 py-2 font-mono text-[12px] font-semibold tracking-[-0.02em] text-[#171717] transition duration-200 hover:opacity-60';
  const signInButtonClass =
    'inline-flex h-9 items-center justify-center border border-black/10 bg-white px-4 text-sm font-medium text-[#171717] transition hover:bg-[#171717] hover:text-white';
  const userInitial = (userName?.trim()?.charAt(0) || 'U').toUpperCase();
  const links = [
    { href: '/leaderboard', label: t((m) => m.nav.leaderboard) },
    { href: '/rules', label: t((m) => m.nav.rules) },
    { href: '/methodology', label: t((m) => m.nav.methodology) },
    { href: '/join', label: t((m) => m.nav.join) },
  ];

  return (
    <header className="fixed inset-x-0 top-0 z-50 bg-white/96 backdrop-blur-sm">
      <div className="mx-auto max-w-[1480px] border-x border-b border-black/10 bg-white px-4 py-4 md:px-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center justify-between gap-4">
            <Link
              href="/"
              className="text-2xl font-semibold tracking-[-0.05em] text-[#171717]"
            >
              AgentTrader
            </Link>

            <div className="flex items-center gap-2 md:hidden">
              <button
                aria-label={localeSwitchLabel}
                className={localeButtonClass}
                title={localeSwitchLabel}
                type="button"
                onClick={toggleLocale}
              >
                {localeButtonLabel}
              </button>
              <TopNavUserActions
                authEnabled={authEnabled}
                signInButtonClass={signInButtonClass}
                userInitial={userInitial}
                userName={userName}
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
            <nav className="flex flex-wrap gap-2">
              {links.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={subtleButtonClass}
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            <div className="hidden md:flex md:items-center md:gap-2">
              <button
                aria-label={localeSwitchLabel}
                className={localeButtonClass}
                title={localeSwitchLabel}
                type="button"
                onClick={toggleLocale}
              >
                {localeButtonLabel}
              </button>
              <TopNavUserActions
                authEnabled={authEnabled}
                signInButtonClass={signInButtonClass}
                userInitial={userInitial}
                userName={userName}
              />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function TopNavUserActions({
  authEnabled,
  userName,
  userInitial,
  signInButtonClass,
}: {
  authEnabled: boolean;
  userName?: string | null;
  userInitial: string;
  signInButtonClass: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { t } = useSiteLocale();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (!containerRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  if (!authEnabled) {
    return null;
  }

  if (!userName) {
    return (
      <Link href="/sign-in?callbackURL=/my-agent" className={signInButtonClass}>
        {t((m) => m.nav.signIn)}
      </Link>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="relative z-50 inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-black/10 bg-[#fafafa] text-sm font-semibold text-[#171717] transition hover:bg-[#171717] hover:text-white"
        type="button"
        onClick={() => setIsOpen((open) => !open)}
      >
        {userInitial}
      </button>
      {isOpen ? (
        <div className="absolute right-0 z-50 mt-2 w-56 border border-black/10 bg-white shadow-[0_18px_36px_rgba(33,22,13,0.06)]">
          <div className="border-b border-black/10 px-4 py-4">
            <p className="text-sm font-semibold text-[#171717]">{userName}</p>
          </div>
          <div className="py-2">
            <Link
              href="/my-agent"
              className="block px-4 py-2 text-sm text-[#171717] transition hover:bg-[#fafafa]"
              onClick={() => setIsOpen(false)}
            >
              {t((m) => m.nav.myAgents)}
            </Link>
            <SignOutButton
              className="block w-full px-4 py-2 text-left text-sm text-[#171717] transition hover:bg-[#fafafa]"
              onClick={() => setIsOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
