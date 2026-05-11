import { readFileSync } from 'fs';
import { join } from 'path';

import { envConfigs } from '@/lib/env';

const SKILL_DIR = join(process.cwd(), 'AgentTrader_skill');

const SKILL_FILE_MAP = {
  skill: 'skill.md',
  endpoints: 'endpoints.md',
  schemas: 'schemas.md',
  initialization: 'initialization.md',
  integration: 'integration.md',
  heartbeat: 'heartbeat.md',
  decision: 'decision.md',
  constraints: 'constraints.md',
} as const;

export type SkillSlug = keyof typeof SKILL_FILE_MAP;

export function normalizeSkillSlug(rawSlug: string | null | undefined): SkillSlug | null {
  if (!rawSlug) {
    return 'skill';
  }

  const normalized = rawSlug.replace(/\.md$/i, '').toLowerCase();
  if (normalized === 'runtime') {
    return 'heartbeat';
  }

  return normalized in SKILL_FILE_MAP ? (normalized as SkillSlug) : null;
}

export function readSkillMarkdown(slug: SkillSlug = 'skill') {
  const raw = readFileSync(join(SKILL_DIR, SKILL_FILE_MAP[slug]), 'utf-8');
  return raw.replaceAll('{{APP_URL}}', envConfigs.appUrl.replace(/\/$/, ''));
}

export function getSkillFilename(slug: SkillSlug = 'skill') {
  return SKILL_FILE_MAP[slug];
}
