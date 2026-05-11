import { headers } from 'next/headers';

import { getAuth } from '@/core/auth';
import { createId } from '@/db/id';
import { readStore, updateStore } from '@/db/store';
import { getSqlClient, isDatabaseConfigured } from '@/db/postgres';

type ShadowUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: string;
  updatedAt: string;
};

async function upsertShadowUser(input: {
  name: string;
  email: string;
  image?: string | null;
  emailVerified?: boolean;
}) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const now = new Date().toISOString();
  const name = input.name.trim() || normalizedEmail;
  const image = input.image ?? null;
  const emailVerified = Boolean(input.emailVerified);

  if (isDatabaseConfigured()) {
    const sql = getSqlClient();
    const store = readStore();
    const storeUser = store.users.find(
      (item) => item.email.toLowerCase() === normalizedEmail
    );
    const existingRows = await sql<
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
      where lower(email) = ${normalizedEmail}
      limit 1
    `;

    const existing = existingRows[0];
    const userId = storeUser?.id ?? existing?.id ?? createId('user');
    const createdAtValue =
      existing?.created_at ?? storeUser?.createdAt ?? now;
    const updatedUser: ShadowUser = {
      id: userId,
      name: name || storeUser?.name || normalizedEmail,
      email: normalizedEmail,
      emailVerified: existing?.email_verified ?? storeUser?.emailVerified ?? emailVerified,
      image: existing?.image ?? storeUser?.image ?? image,
      createdAt:
        createdAtValue instanceof Date
          ? createdAtValue.toISOString()
          : new Date(createdAtValue).toISOString(),
      updatedAt: now,
    };

    const shouldUpdateDatabase =
      !existing ||
      existing.id !== userId ||
      existing.name !== updatedUser.name ||
      existing.email_verified !== updatedUser.emailVerified ||
      (existing.image ?? null) !== updatedUser.image;

    if (shouldUpdateDatabase) {
      await sql`
        insert into auth_users (
          id, name, email, email_verified, image, created_at, updated_at
        ) values (
          ${userId},
          ${updatedUser.name},
          ${normalizedEmail},
          ${updatedUser.emailVerified},
          ${updatedUser.image},
          ${updatedUser.createdAt},
          ${now}
        )
        on conflict (email) do update set
          id = excluded.id,
          name = excluded.name,
          email_verified = excluded.email_verified,
          image = excluded.image,
          updated_at = excluded.updated_at
      `;
    }

    const persistedStoreUser = store.users.find((item) => item.id === userId);
    const shouldUpdateStore =
      !persistedStoreUser ||
      persistedStoreUser.name !== updatedUser.name ||
      persistedStoreUser.email !== updatedUser.email ||
      persistedStoreUser.emailVerified !== updatedUser.emailVerified ||
      (persistedStoreUser.image ?? null) !== updatedUser.image;

    if (shouldUpdateStore) {
      await updateStore((draft) => {
        const index = draft.users.findIndex((item) => item.id === userId);
        if (index >= 0) {
          draft.users[index] = updatedUser;
        } else {
          draft.users.push(updatedUser);
        }
      });
    }

    return updatedUser;
  }

  const store = readStore();
  const existing = store.users.find(
    (item) => item.email.toLowerCase() === normalizedEmail
  );
  const userId = existing?.id ?? createId('user');
  const createdAt = existing?.createdAt ?? now;

  const updatedUser: ShadowUser = {
    id: userId,
    name,
    email: normalizedEmail,
    emailVerified,
    image,
    createdAt,
    updatedAt: now,
  };

  const shouldUpdateStore =
    !existing ||
    existing.name !== updatedUser.name ||
    existing.email !== updatedUser.email ||
    existing.emailVerified !== updatedUser.emailVerified ||
    (existing.image ?? null) !== updatedUser.image;

  if (shouldUpdateStore) {
    await updateStore((draft) => {
      const index = draft.users.findIndex((item) => item.id === userId);
      if (index >= 0) {
        draft.users[index] = updatedUser;
      } else {
        draft.users.push(updatedUser);
      }
    });
  }

  return updatedUser;
}

export async function getSessionUser() {
  return getSessionUserWithOptions({ syncShadowUser: true });
}

export async function getLightweightSessionUser() {
  return getSessionUserWithOptions({ syncShadowUser: false });
}

async function getSessionUserWithOptions({
  syncShadowUser,
}: {
  syncShadowUser: boolean;
}) {
  if (!isDatabaseConfigured()) {
    return null;
  }

  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.email) {
      return null;
    }

    if (!syncShadowUser) {
      return {
        sessionId: session.session.id,
        userId: session.user.id,
        authUserId: session.user.id,
        name: session.user.name || session.user.email,
        email: session.user.email,
        image: session.user.image ?? null,
      };
    }

    const shadowUser = await upsertShadowUser({
      name: session.user.name || session.user.email,
      email: session.user.email,
      image: session.user.image ?? null,
      emailVerified: Boolean((session.user as { emailVerified?: boolean }).emailVerified),
    });

    return {
      sessionId: session.session.id,
      userId: shadowUser.id,
      authUserId: session.user.id,
      name: shadowUser.name,
      email: shadowUser.email,
      image: shadowUser.image,
    };
  } catch {
    return null;
  }
}
