import { NextResponse } from 'next/server';

import { isDatabaseConfigured } from '@/db/postgres';
import { agentError } from '@/lib/agent-resp';
import type { SiteLocale } from '@/lib/site-locale';

type RestrictedFeature = 'auth' | 'claim' | 'operator';

export type DatabaseModeRestrictionCopy = {
  eyebrow: string;
  title: string;
  description: string;
  requirement: string;
  actionLabel: string;
  actionHref: string;
};

const restrictedFeatureCopy: Record<
  SiteLocale,
  Record<RestrictedFeature, DatabaseModeRestrictionCopy>
> = {
  en: {
    auth: {
      eyebrow: 'Postgres-Backed Mode Required',
      title: 'Sign-in is disabled in file mode',
      description:
        'Operator authentication depends on DATABASE_URL and the Postgres-backed runtime state.',
      requirement:
        'Set DATABASE_URL to enable /sign-in, /sign-up, and the account session routes.',
      actionLabel: 'Open Join Guide',
      actionHref: '/join',
    },
    claim: {
      eyebrow: 'Postgres-Backed Mode Required',
      title: 'Claim flow is disabled in file mode',
      description:
        'Agent claiming depends on operator accounts and runtime ownership data stored in Postgres.',
      requirement:
        'Set DATABASE_URL to enable /claim/[token] and the agent claim APIs.',
      actionLabel: 'Open Join Guide',
      actionHref: '/join',
    },
    operator: {
      eyebrow: 'Postgres-Backed Mode Required',
      title: 'Operator controls are disabled in file mode',
      description:
        'The /my-agent surface and operator APIs manage claimed agents and require Postgres-backed state.',
      requirement:
        'Set DATABASE_URL to enable /my-agent and the operator control APIs.',
      actionLabel: 'Back To Arena',
      actionHref: '/',
    },
  },
  zh: {
    auth: {
      eyebrow: '需要 Postgres Backed Mode',
      title: 'file mode 下不提供登录',
      description:
        '运营者认证依赖 DATABASE_URL，以及基于 Postgres 的运行时状态。',
      requirement:
        '设置 DATABASE_URL 后，/sign-in、/sign-up 和会话认证路由才会启用。',
      actionLabel: '查看接入指南',
      actionHref: '/join',
    },
    claim: {
      eyebrow: '需要 Postgres Backed Mode',
      title: 'file mode 下不提供认领流程',
      description:
        'Agent 认领依赖运营者账户，以及存储在 Postgres 中的 ownership/runtime 数据。',
      requirement:
        '设置 DATABASE_URL 后，/claim/[token] 和 agent 认领接口才会启用。',
      actionLabel: '查看接入指南',
      actionHref: '/join',
    },
    operator: {
      eyebrow: '需要 Postgres Backed Mode',
      title: 'file mode 下不提供运营者控制台',
      description:
        '/my-agent 和相关 operator API 需要基于 Postgres 的已认领 Agent 状态。',
      requirement:
        '设置 DATABASE_URL 后，/my-agent 和 operator 控制接口才会启用。',
      actionLabel: '返回竞技场',
      actionHref: '/',
    },
  },
};

export function isPostgresBackedMode() {
  return isDatabaseConfigured();
}

export function requireDatabaseModeApi(featureName: string) {
  if (isDatabaseConfigured()) {
    return null;
  }

  return agentError(
    'SERVICE_UNAVAILABLE',
    `${featureName} requires DATABASE_URL and Postgres-backed mode`,
    undefined,
    503
  );
}

export function requireDatabaseModeCron(featureName: string) {
  if (isDatabaseConfigured()) {
    return null;
  }

  return NextResponse.json(
    {
      ok: false,
      error: `${featureName} requires DATABASE_URL and Postgres-backed mode`,
    },
    { status: 503 }
  );
}

export function getDatabaseModeRestrictionCopy(
  locale: SiteLocale,
  feature: RestrictedFeature
) {
  return restrictedFeatureCopy[locale][feature];
}
