import { ModeRestrictedPage } from '@/components/mode-restricted-page';
import { ClaimPageClient } from '@/components/claim-page-client';
import {
  getDatabaseModeRestrictionCopy,
  isPostgresBackedMode,
} from '@/lib/database-mode';
import { getRequestSiteLocale } from '@/lib/site-locale-server';

export default async function ClaimPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  if (!isPostgresBackedMode()) {
    const locale = await getRequestSiteLocale();
    return (
      <ModeRestrictedPage
        copy={getDatabaseModeRestrictionCopy(locale, 'claim')}
      />
    );
  }

  const { token } = await params;

  return <ClaimPageClient token={token} />;
}
