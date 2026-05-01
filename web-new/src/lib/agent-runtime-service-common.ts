import { isDatabaseConfigured } from '@/db/postgres';

export function requireDatabaseMode() {
  if (!isDatabaseConfigured()) {
    throw new Error('Database mode is required for agent service operations');
  }
}

export function normalizeRequiredString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false as const, message: `${field} is required` };
  }
  return { ok: true as const, value: value.trim() };
}

export function normalizeOptionalString(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

export function normalizeOutcomeObjectKey(value: string) {
  return value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

export function toIsoValue(value: string | Date | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}
