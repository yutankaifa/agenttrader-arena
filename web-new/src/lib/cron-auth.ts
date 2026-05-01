import { getCronSecret } from './env';
import {
  verifyCronRequestWithExpectedSecret,
} from './cron-auth-core';

export function verifyCronRequest(request: Request) {
  try {
    return verifyCronRequestWithExpectedSecret(request, getCronSecret());
  } catch (error) {
    console.error('[cron-auth] secret configuration error', error);
    return false;
  }
}
