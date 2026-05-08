import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { ensureApplicationDatabaseSchema } from '@/db/app-schema';
import type { AgentTraderStore } from '@/db/schema';
import { getSqlClient, isDatabaseConfigured } from '@/db/postgres';
import { buildSeedStore } from '@/db/seed';
import { normalizeTimestampToIsoString } from '@/lib/timestamp';

const STORE_PATH = join(process.cwd(), 'data', 'agentrader-store.json');
const APP_STATE_ID = 'main';
const DB_RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  '57P01',
  '57P02',
  '57P03',
]);

function ensureStore() {
  if (existsSync(STORE_PATH)) {
    return;
  }

  mkdirSync(dirname(STORE_PATH), { recursive: true });
  const seed = buildSeedStore();
  writeFileSync(STORE_PATH, JSON.stringify(seed, null, 2), 'utf-8');
}

function readFileStore(): AgentTraderStore {
  ensureStore();
  return JSON.parse(readFileSync(STORE_PATH, 'utf-8')) as AgentTraderStore;
}

function writeFileStore(store: AgentTraderStore) {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

function mergeUsers(
  payloadUsers: AgentTraderStore['users'],
  authUsers: AgentTraderStore['users']
) {
  const merged = [...payloadUsers];

  for (const authUser of authUsers) {
    const existingIndex = merged.findIndex(
      (item) =>
        item.id === authUser.id ||
        item.email.toLowerCase() === authUser.email.toLowerCase()
    );

    if (existingIndex >= 0) {
      const existing = merged[existingIndex];
      merged[existingIndex] = {
        ...authUser,
        id: existing.id,
        createdAt: existing.createdAt,
      };
      continue;
    }

    merged.push(authUser);
  }

  return merged;
}

function toIsoString(value: unknown) {
  if (value instanceof Date || typeof value === 'string') {
    return normalizeTimestampToIsoString(value) ?? new Date().toISOString();
  }
  return new Date().toISOString();
}

function isRetryableDatabaseError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code =
    'code' in error && typeof error.code === 'string' ? error.code : null;
  return code ? DB_RETRYABLE_ERROR_CODES.has(code) : false;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withDatabaseRetry<T>(task: () => Promise<T>, label: string) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (!isRetryableDatabaseError(error) || attempt === 2) {
        break;
      }
      await sleep(250 * (attempt + 1));
    }
  }

  console.error(`[store] ${label} failed`, lastError);
  throw lastError;
}

async function ensureDatabaseTables() {
  await withDatabaseRetry(
    () => ensureApplicationDatabaseSchema(),
    'ensureDatabaseTables'
  );
}

async function upsertAuthState(store: AgentTraderStore) {
  const sql = getSqlClient();
  for (const user of store.users) {
    await sql`
      insert into auth_users (
        id, name, email, email_verified, image, created_at, updated_at
      ) values (
        ${user.id},
        ${user.name},
        ${user.email},
        ${user.emailVerified},
        ${user.image},
        ${user.createdAt},
        ${user.updatedAt}
      )
      on conflict (id) do update set
        name = excluded.name,
        email = excluded.email,
        email_verified = excluded.email_verified,
        image = excluded.image,
        updated_at = excluded.updated_at
    `;
  }

  for (const session of store.sessions) {
    await sql`
      insert into auth_sessions (
        id, user_id, token, expires_at, created_at, updated_at
      ) values (
        ${session.id},
        ${session.userId},
        ${session.token},
        ${session.expiresAt},
        ${session.createdAt},
        ${session.updatedAt}
      )
      on conflict (id) do update set
        user_id = excluded.user_id,
        token = excluded.token,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `;
  }
}

async function loadDatabaseStore() {
  await ensureDatabaseTables();
  const sql = getSqlClient();
  const rows = await withDatabaseRetry(
    () => sql<{ payload: AgentTraderStore }[]>`
      select payload from app_state where id = ${APP_STATE_ID}
    `,
    'loadDatabaseStore.selectState'
  );

  if (!rows.length) {
    const source = existsSync(STORE_PATH) ? readFileStore() : buildSeedStore();
    await upsertAuthState(source);
    await withDatabaseRetry(
      () => sql`
        insert into app_state (id, payload, updated_at)
        values (${APP_STATE_ID}, ${sql.json(serializeStore(source))}, now())
        on conflict (id) do nothing
      `,
      'loadDatabaseStore.seedState'
    );

    const insertedRows = await withDatabaseRetry(
      () => sql<{ payload: AgentTraderStore }[]>`
        select payload from app_state where id = ${APP_STATE_ID}
      `,
      'loadDatabaseStore.selectSeededState'
    );

    return (insertedRows[0]?.payload as AgentTraderStore | undefined) ?? source;
  }

  const store = rows[0].payload as AgentTraderStore;
  const userRows = await withDatabaseRetry(
    () =>
      sql<
        {
          id: string;
          name: string;
          email: string;
          email_verified: boolean;
          image: string | null;
          created_at: string | Date;
          updated_at: string | Date;
        }[]
      >`
        select id, name, email, email_verified, image, created_at, updated_at
        from auth_users
        order by created_at asc
      `,
    'loadDatabaseStore.selectUsers'
  );
  const sessionRows = await withDatabaseRetry(
    () =>
      sql<
        {
          id: string;
          user_id: string;
          token: string;
          expires_at: string | Date;
          created_at: string | Date;
          updated_at: string | Date;
        }[]
      >`
        select id, user_id, token, expires_at, created_at, updated_at
        from auth_sessions
        order by created_at asc
      `,
    'loadDatabaseStore.selectSessions'
  );

  const authUsers = userRows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.email_verified,
    image: row.image,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  }));
  store.users = mergeUsers(store.users, authUsers);
  store.sessions = sessionRows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    token: row.token,
    expiresAt: toIsoString(row.expires_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  }));

  return store;
}

async function persistDatabaseStore(store: AgentTraderStore) {
  const sql = getSqlClient();
  await withDatabaseRetry(
    () => sql`
      insert into app_state (id, payload, updated_at)
      values (${APP_STATE_ID}, ${sql.json(serializeStore(store))}, now())
      on conflict (id) do update set
        payload = excluded.payload,
        updated_at = now()
    `,
    'persistDatabaseStore'
  );
}

let persistenceMode: 'postgres' | 'file' = isDatabaseConfigured()
  ? 'postgres'
  : 'file';

const initialStorePromise = isDatabaseConfigured()
  ? loadDatabaseStore().catch((error) => {
      persistenceMode = 'file';
      console.error('[store] falling back to file persistence', error);
      return readFileStore();
    })
  : Promise.resolve(readFileStore());

let inMemoryStore: AgentTraderStore = await initialStorePromise;
let writeQueue = Promise.resolve();

function cloneStore(store: AgentTraderStore) {
  return structuredClone(store);
}

function serializeStore(store: AgentTraderStore) {
  return JSON.parse(JSON.stringify(store));
}

export function readStore(): AgentTraderStore {
  return cloneStore(inMemoryStore);
}

export async function writeStore(store: AgentTraderStore) {
  inMemoryStore = cloneStore(store);
  if (persistenceMode === 'postgres') {
    await persistDatabaseStore(inMemoryStore);
    return;
  }

  writeFileStore(inMemoryStore);
}

export async function updateStore<T>(
  mutator: (store: AgentTraderStore) => T | Promise<T>
): Promise<T> {
  let result!: T;

  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      const draft = cloneStore(inMemoryStore);
      result = await mutator(draft);
      inMemoryStore = draft;
      if (persistenceMode === 'postgres') {
        await persistDatabaseStore(inMemoryStore);
        return;
      }
      writeFileStore(inMemoryStore);
    });

  await writeQueue;
  return result;
}

export function storePath() {
  return STORE_PATH;
}

export function getPersistenceMode() {
  return persistenceMode;
}
