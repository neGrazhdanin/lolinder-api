export class RiotApiError extends Error {
  constructor(
    readonly endpoint: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(`Riot ${endpoint} responded with ${status}`);
    this.name = 'RiotApiError';
  }
}

/** Retrying will not help: the payload stays the same, so processors should fail the job for good. */
export class RiotSchemaError extends Error {
  constructor(
    readonly endpoint: string,
    cause: unknown,
  ) {
    super(`Riot ${endpoint} response does not match the schema`, { cause });
    this.name = 'RiotSchemaError';
  }
}

export class RiotRateLimitedError extends Error {
  constructor(
    readonly host: string,
    readonly endpoint: string,
    readonly retryInMs: number,
  ) {
    super(`Riot ${host} ${endpoint} is rate limited for ${retryInMs} ms`);
    this.name = 'RiotRateLimitedError';
  }
}
