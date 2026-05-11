import { getSqlClient } from '@/db/postgres';

export type SignInDiagnosisStatus =
  | 'unknown'
  | 'email_not_found'
  | 'password_mismatch'
  | 'social_sign_in_required'
  | 'sign_in_method_mismatch';

export type SignInDiagnosis = {
  status: SignInDiagnosisStatus;
  providers: string[];
};

type AccountMethodRow = {
  user_id: string | null;
  provider_id: string | null;
  has_password: boolean | null;
};

const passwordProviderIds = new Set(['credential', 'credentials', 'email', 'email-password']);

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function buildSignInDiagnosis(rows: AccountMethodRow[]): SignInDiagnosis {
  if (rows.length === 0 || !rows.some((row) => row.user_id)) {
    return { status: 'email_not_found', providers: [] };
  }

  const providerIds = new Set<string>();
  let hasPasswordAccount = false;

  for (const row of rows) {
    const providerId = row.provider_id?.trim().toLowerCase();
    if (!providerId) continue;

    providerIds.add(providerId);
    if (row.has_password || passwordProviderIds.has(providerId)) {
      hasPasswordAccount = true;
    }
  }

  const socialProviders = Array.from(providerIds).filter(
    (providerId) => !passwordProviderIds.has(providerId)
  );

  if (hasPasswordAccount) {
    return { status: 'password_mismatch', providers: socialProviders };
  }

  if (socialProviders.length > 0) {
    return {
      status: 'social_sign_in_required',
      providers: socialProviders,
    };
  }

  return { status: 'sign_in_method_mismatch', providers: [] };
}

export async function diagnoseSignInFailure(email: string): Promise<SignInDiagnosis> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return { status: 'unknown', providers: [] };
  }

  const sql = getSqlClient();
  const rows = await sql<AccountMethodRow[]>`
    select
      u.id as user_id,
      a.provider_id,
      a.password is not null as has_password
    from "user" u
    left join account a on a.user_id = u.id
    where lower(u.email) = ${normalizedEmail}
    limit 10
  `;

  return buildSignInDiagnosis(rows);
}
