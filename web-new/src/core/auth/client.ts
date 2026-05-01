'use client';

import { createAuthClient } from 'better-auth/react';

function getAuthBaseUrl() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const normalizedAppUrl = appUrl?.replace(/\/$/, '') || 'http://localhost:3000';
  return `${normalizedAppUrl}/api/auth`;
}

export const authClient = createAuthClient({
  baseURL: getAuthBaseUrl(),
});

export const { signIn, signOut, signUp, useSession } = authClient;
