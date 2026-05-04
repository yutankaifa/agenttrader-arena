'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { useSiteLocale, useSiteLocaleButtonLabel } from '@/components/site-locale-provider';
import { SiteLogo } from '@/components/site-logo';
import { SignOutButton } from '@/components/sign-out-button';

type TopNavProps = {
  userName?: string | null;
  authEnabled: boolean;
};

export function TopNav({ userName, authEnabled }: TopNavProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    if (!isMobileMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (!mobileMenuRef.current?.contains(target)) {
        setIsMobileMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobileMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isMobileMenuOpen]);

  return (
    <header className="fixed inset-x-0 top-0 z-50 bg-white/96 backdrop-blur-sm">
      <div
        ref={mobileMenuRef}
        className="mx-auto max-w-[1480px] border-x border-b border-black/10 bg-white px-4 py-3 md:px-6 md:py-4"
      >
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="inline-flex items-center gap-3">
            <SiteLogo size={40} priority />
            <span className="text-xl font-semibold tracking-[-0.05em] text-[#171717] md:text-2xl">
              AgentTrader
            </span>
          </Link>

          <button
            aria-expanded={isMobileMenuOpen}
            aria-label={isMobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="inline-flex h-10 items-center gap-3 border border-black/10 bg-white px-3 md:hidden"
            type="button"
            onClick={() => setIsMobileMenuOpen((open) => !open)}
          >
            <span className="mono text-[11px] uppercase tracking-[0.18em] text-[#171717]">
              Menu
            </span>
            <span className="flex w-4 flex-col gap-1.5" aria-hidden="true">
              <span
                className={`h-px bg-[#171717] transition-transform duration-200 ${
                  isMobileMenuOpen ? 'translate-y-[7px] rotate-45' : ''
                }`}
              />
              <span
                className={`h-px bg-[#171717] transition-opacity duration-200 ${
                  isMobileMenuOpen ? 'opacity-0' : 'opacity-100'
                }`}
              />
              <span
                className={`h-px bg-[#171717] transition-transform duration-200 ${
                  isMobileMenuOpen ? '-translate-y-[7px] -rotate-45' : ''
                }`}
              />
            </span>
          </button>

          <div className="hidden md:flex md:items-center md:gap-2">
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

        <div
          className={`overflow-hidden transition-all duration-200 md:hidden ${
            isMobileMenuOpen ? 'mt-3 max-h-[420px] opacity-100' : 'max-h-0 opacity-0'
          }`}
        >
          <div className="border-t border-black/10 pt-3">
            <nav className="grid gap-2">
              {links.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${subtleButtonClass} justify-between px-4`}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            <div className="mt-3 grid gap-2">
              <button
                aria-label={localeSwitchLabel}
                className={`${subtleButtonClass} px-4`}
                title={localeSwitchLabel}
                type="button"
                onClick={() => {
                  toggleLocale();
                  setIsMobileMenuOpen(false);
                }}
              >
                {localeButtonLabel}
              </button>

              <TopNavMobileAccountActions
                authEnabled={authEnabled}
                signInButtonClass={signInButtonClass}
                userName={userName}
                onNavigate={() => setIsMobileMenuOpen(false)}
              />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function TopNavMobileAccountActions({
  authEnabled,
  userName,
  signInButtonClass,
  onNavigate,
}: {
  authEnabled: boolean;
  userName?: string | null;
  signInButtonClass: string;
  onNavigate: () => void;
}) {
  const { t } = useSiteLocale();

  if (!authEnabled) {
    return null;
  }

  if (!userName) {
    return (
      <Link
        href="/sign-in?callbackURL=/my-agent"
        className={`${signInButtonClass} w-full justify-center`}
        onClick={onNavigate}
      >
        {t((m) => m.nav.signIn)}
      </Link>
    );
  }

  return (
    <div className="border border-black/10 bg-[#fafafa]">
      <div className="flex items-center justify-between gap-3 border-b border-black/10 px-4 py-3">
        <div>
          <p className="mono text-[10px] uppercase tracking-[0.18em] text-black/40">
            Account
          </p>
          <p className="mt-1 text-sm font-semibold text-[#171717]">{userName}</p>
        </div>
        <Link
          href="/my-agent"
          className="button-subtle button-nav px-3"
          onClick={onNavigate}
        >
          {t((m) => m.nav.myAgents)}
        </Link>
      </div>
      <div className="p-2">
        <SignOutButton
          className="flex w-full items-center justify-center px-4 py-2 text-center text-sm text-[#171717] transition hover:bg-white"
          onClick={onNavigate}
        />
      </div>
    </div>
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
