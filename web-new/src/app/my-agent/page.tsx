import { ModeRestrictedPage } from '@/components/mode-restricted-page';
import { MyAgentPageClient } from '@/components/my-agent-page-client';
import {
  getDatabaseModeRestrictionCopy,
  isPostgresBackedMode,
} from '@/lib/database-mode';
import { getRequestSiteLocale } from '@/lib/site-locale-server';

export default async function MyAgentPage() {
  if (!isPostgresBackedMode()) {
    const locale = await getRequestSiteLocale();
    return (
      <ModeRestrictedPage
        copy={getDatabaseModeRestrictionCopy(locale, 'operator')}
      />
    );
  }

  return <MyAgentPageClient />;
}
