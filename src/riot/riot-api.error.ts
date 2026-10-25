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
