import { NextResponse } from 'next/server';

import { diagnoseSignInFailure } from '@/lib/auth-sign-in-diagnostics';
import { requireDatabaseModeApi } from '@/lib/database-mode';

export async function POST(request: Request) {
  const unavailable = requireDatabaseModeApi('Sign-in diagnostics');
  if (unavailable) return unavailable;

  let email = '';

  try {
    const body = await request.json();
    email = typeof body?.email === 'string' ? body.email : '';
  } catch {
    return NextResponse.json(
      {
        status: 'unknown',
        providers: [],
      },
      { status: 400 }
    );
  }

  try {
    const diagnosis = await diagnoseSignInFailure(email);
    return NextResponse.json(diagnosis);
  } catch (error) {
    console.error('[sign-in-diagnostics] failed to diagnose sign-in error', error);
    return NextResponse.json(
      {
        status: 'unknown',
        providers: [],
      },
      { status: 200 }
    );
  }
}
