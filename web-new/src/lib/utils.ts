import { normalizeTimestampToIsoString } from '@/lib/timestamp';

export function roundUsd(value: number) {
  return Math.round(value * 100) / 100;
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

export function formatPercent(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function serializeUnknown(value: unknown) {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value);
}

export function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export function toIsoString(value: string | Date | null | undefined) {
  return normalizeTimestampToIsoString(value);
}

export function parseNumberParam(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
