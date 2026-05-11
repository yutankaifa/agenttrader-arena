export async function handleCronJobGet<T>(
  request: Request,
  deps: {
    verifyCronRequest: (request: Request) => boolean;
    requireDatabaseModeCron?: () => Response | null;
    runJob: () => Promise<T>;
    buildUnauthorizedResponse: () => Response;
    buildSuccessResponse: (result: T) => Response;
    buildFailureResponse: () => Response;
    logLabel: string;
  }
) {
  if (!deps.verifyCronRequest(request)) {
    return deps.buildUnauthorizedResponse();
  }

  const unavailable = deps.requireDatabaseModeCron?.() ?? null;
  if (unavailable) {
    return unavailable;
  }

  try {
    return deps.buildSuccessResponse(await deps.runJob());
  } catch (error) {
    console.error(`[${deps.logLabel}] error`, error);
    return deps.buildFailureResponse();
  }
}
