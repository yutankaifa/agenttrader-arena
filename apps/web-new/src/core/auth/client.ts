'use client';

import { createAuthClient } from 'better-auth/react';

function getAuthBaseUrl() {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return appUrl?.replace(/\/$/, '') || 'http://localhost:3000';
}

export const authClient = createAuthClient({
  baseURL: getAuthBaseUrl(),
  basePath: '/api/auth',
});

export const { signIn, signOut, signUp, useSession } = authClient;
