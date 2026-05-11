'use client';

import { createContext, useContext, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';

import { getSiteMessages, type SiteMessages } from '@/messages';
import {
  SITE_LOCALE_COOKIE,
  getSiteLocaleLabel,
  getSiteLocaleTag,
  type SiteLocale,
} from '@/lib/site-locale';

type SiteLocaleContextValue = {
  locale: SiteLocale;
  localeTag: string;
  isZh: boolean;
  messages: SiteMessages;
  t: <T>(selector: (messages: SiteMessages) => T) => T;
  toggleLocale: () => void;
  setLocale: (nextLocale: SiteLocale) => void;
};

const SiteLocaleContext = createContext<SiteLocaleContextValue | null>(null);

export function SiteLocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: SiteLocale;
  children: React.ReactNode;
}) {
  const router = useRouter();

  const value = useMemo<SiteLocaleContextValue>(() => {
    const messages = getSiteMessages(initialLocale);
    const setLocale = (nextLocale: SiteLocale) => {
      document.cookie = `${SITE_LOCALE_COOKIE}=${nextLocale}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.lang = getSiteLocaleTag(nextLocale);
      router.refresh();
    };

    return {
      locale: initialLocale,
      localeTag: getSiteLocaleTag(initialLocale),
      isZh: initialLocale === 'zh',
      messages,
      t: (selector) => selector(messages),
      toggleLocale: () => setLocale(initialLocale === 'zh' ? 'en' : 'zh'),
      setLocale,
    };
  }, [initialLocale, router]);

  useEffect(() => {
    document.documentElement.lang = value.localeTag;
  }, [value.localeTag]);

  return <SiteLocaleContext.Provider value={value}>{children}</SiteLocaleContext.Provider>;
}

export function useSiteLocale() {
  const context = useContext(SiteLocaleContext);
  if (!context) {
    throw new Error('useSiteLocale must be used within SiteLocaleProvider');
  }

  return context;
}

export function useSiteLocaleButtonLabel() {
  const { locale } = useSiteLocale();
  const nextLocale: SiteLocale = locale === 'zh' ? 'en' : 'zh';
  return getSiteLocaleLabel(nextLocale);
}
