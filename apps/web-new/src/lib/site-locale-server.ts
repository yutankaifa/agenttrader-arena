import { cookies, headers } from 'next/headers';

import { SITE_LOCALE_COOKIE, normalizeSiteLocale, type SiteLocale } from '@/lib/site-locale';

export async function getRequestSiteLocale(): Promise<SiteLocale> {
  const cookieStore = await cookies();
  const cookieLocale = normalizeSiteLocale(cookieStore.get(SITE_LOCALE_COOKIE)?.value);
  if (cookieStore.has(SITE_LOCALE_COOKIE)) {
    return cookieLocale;
  }

  const headerStore = await headers();
  return normalizeSiteLocale(headerStore.get('accept-language'));
}
