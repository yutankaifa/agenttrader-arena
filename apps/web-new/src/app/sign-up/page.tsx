import { redirect } from 'next/navigation';

import { ModeRestrictedPage } from '@/components/mode-restricted-page';
import {
  getDatabaseModeRestrictionCopy,
  isPostgresBackedMode,
} from '@/lib/database-mode';
import { getRequestSiteLocale } from '@/lib/site-locale-server';

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackURL?: string }>;
}) {
  if (!isPostgresBackedMode()) {
    const locale = await getRequestSiteLocale();
    return (
      <ModeRestrictedPage
        copy={getDatabaseModeRestrictionCopy(locale, 'auth')}
      />
    );
  }

  const { callbackURL } = await searchParams;
  const safeCallbackURL =
    callbackURL && callbackURL.startsWith('/') ? callbackURL : '/my-agent';

  redirect(
    `/sign-in?mode=sign-up&callbackURL=${encodeURIComponent(safeCallbackURL)}`
  );
}
