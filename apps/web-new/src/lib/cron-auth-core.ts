export function extractCronSecretFromRequest(request: Request) {
  return (
    request.headers.get('x-cron-secret') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    null
  );
}

export function verifyProvidedCronSecret(
  providedSecret: string | null | undefined,
  expectedSecret: string
) {
  return Boolean(providedSecret) && providedSecret === expectedSecret;
}

export function verifyCronRequestWithExpectedSecret(
  request: Request,
  expectedSecret: string
) {
  return verifyProvidedCronSecret(
    extractCronSecretFromRequest(request),
    expectedSecret
  );
}
