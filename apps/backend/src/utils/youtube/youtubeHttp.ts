import { getCircuitBreaker } from '../circuitBreaker.js';
import { isTransientHttpError } from '../httpErrors.js';
import { fetchWithTimeout, getServiceHttpTimeoutMs } from '../httpTimeouts.js';

export class YouTubeHttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public bodyText: string | null,
    public errorMessage: string | null,
    public errorReason: string | null
  ) {
    super(message);
    this.name = 'YouTubeHttpError';
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export async function youtubeGetJson<T>(params: { accessToken: string; url: string }): Promise<T> {
  const circuit = getCircuitBreaker('youtube');
  const timeoutMs = getServiceHttpTimeoutMs('YOUTUBE', 10_000, 1_000, 60_000);

  return circuit.execute(
    async () => {
      const resp = await fetchWithTimeout({
        url: params.url,
        service: 'youtube',
        timeoutMs,
        timeoutReason: 'youtube_timeout',
        init: {
          headers: {
            Authorization: `Bearer ${params.accessToken}`,
            Accept: 'application/json',
          },
        },
      });

      const text = await resp.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (!resp.ok) {
        const jsonRecord = asRecord(json);
        const errorRecord = asRecord(jsonRecord.error);
        const errorMessage =
          (typeof errorRecord.message === 'string' ? errorRecord.message : null) ||
          (typeof jsonRecord.error_description === 'string' ? jsonRecord.error_description : null);
        const errorErrors = Array.isArray(errorRecord.errors)
          ? (errorRecord.errors as Array<Record<string, unknown>>)
          : [];
        const errorReason =
          errorErrors.length > 0 && typeof errorErrors[0]?.reason === 'string' ? String(errorErrors[0].reason) : null;
        const reasonText = errorMessage || text || resp.statusText;
        throw new YouTubeHttpError(
          `YouTube API error: ${resp.status} ${reasonText}`,
          resp.status,
          text || null,
          errorMessage,
          errorReason
        );
      }
      return json as T;
    },
    { isFailure: isTransientHttpError }
  );
}
