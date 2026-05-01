import { ModeRestrictedPage } from '@/components/mode-restricted-page';
import {
  getDatabaseModeRestrictionCopy,
  isPostgresBackedMode,
} from '@/lib/database-mode';
import { redirect } from 'next/navigation';

import { AuthPageClient } from '@/components/auth-page-client';
import { getSessionUser } from '@/lib/server-session';
import { envConfigs } from '@/lib/env';
import { getRequestSiteLocale } from '@/lib/site-locale-server';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    callbackURL?: string;
    error?: string;
    mode?: 'sign-in' | 'sign-up';
  }>;
}) {
  if (!isPostgresBackedMode()) {
    const locale = await getRequestSiteLocale();
    return (
      <ModeRestrictedPage
        copy={getDatabaseModeRestrictionCopy(locale, 'auth')}
      />
    );
  }

  const { callbackURL, error, mode } = await searchParams;
  const user = await getSessionUser();
  const safeCallbackURL =
    callbackURL && callbackURL.startsWith('/') ? callbackURL : '/my-agent';

  if (user) {
    redirect(safeCallbackURL);
  }

  return (
    <AuthPageClient
      callbackURL={safeCallbackURL}
      error={error ? decodeURIComponent(error) : undefined}
      googleEnabled={Boolean(envConfigs.googleClientId && envConfigs.googleClientSecret)}
      githubEnabled={Boolean(envConfigs.githubClientId && envConfigs.githubClientSecret)}
      initialMode={mode === 'sign-up' ? 'sign-up' : 'sign-in'}
    />
  );
}
