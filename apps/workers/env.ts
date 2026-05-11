import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadEnvFile(envPath = join(process.cwd(), '.env')): void {
  if (!existsSync(envPath)) return;

  const source = readFileSync(envPath, 'utf8');
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}
