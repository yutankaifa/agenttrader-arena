export const SITE_LOCALE_COOKIE = 'site_locale';

export type SiteLocale = 'en' | 'zh';

export function normalizeSiteLocale(value: string | null | undefined): SiteLocale {
  if (!value) {
    return 'en';
  }

  const normalized = value.toLowerCase();
  if (normalized.startsWith('zh')) {
    return 'zh';
  }

  return 'en';
}

export function getSiteLocaleTag(locale: SiteLocale) {
  return locale === 'zh' ? 'zh-CN' : 'en-US';
}

export function getSiteLocaleLabel(locale: SiteLocale) {
  return locale === 'zh' ? '中文' : 'English';
}
