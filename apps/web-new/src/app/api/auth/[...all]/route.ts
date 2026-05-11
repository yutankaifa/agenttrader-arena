import { toNextJsHandler } from 'better-auth/next-js';

import { getAuth } from '@/core/auth';
import { requireDatabaseModeApi } from '@/lib/database-mode';

function requireAccountAuth() {
  return requireDatabaseModeApi('Account auth');
}

export async function GET(request: Request) {
  const unavailable = requireAccountAuth();
  if (unavailable) return unavailable;
  const auth = await getAuth();
  const handler = toNextJsHandler(auth.handler);
  return handler.GET(request);
}

export async function POST(request: Request) {
  const unavailable = requireAccountAuth();
  if (unavailable) return unavailable;
  const auth = await getAuth();
  const handler = toNextJsHandler(auth.handler);
  return handler.POST(request);
}

export async function PATCH(request: Request) {
  const unavailable = requireAccountAuth();
  if (unavailable) return unavailable;
  const auth = await getAuth();
  const handler = toNextJsHandler(auth.handler);
  return handler.PATCH(request);
}

export async function PUT(request: Request) {
  const unavailable = requireAccountAuth();
  if (unavailable) return unavailable;
  const auth = await getAuth();
  const handler = toNextJsHandler(auth.handler);
  return handler.PUT(request);
}

export async function DELETE(request: Request) {
  const unavailable = requireAccountAuth();
  if (unavailable) return unavailable;
  const auth = await getAuth();
  const handler = toNextJsHandler(auth.handler);
  return handler.DELETE(request);
}
