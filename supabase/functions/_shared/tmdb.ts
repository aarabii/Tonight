// supabase/functions/_shared/tmdb.ts

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const getEnv = (key: string): string => {
  if (typeof Deno !== 'undefined' && Deno.env) {
    return Deno.env.get(key) || '';
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key] || '';
  }
  return '';
};

export class TmdbError extends Error {
  readonly status: number;
  readonly code: 'BAD_REQUEST' | 'RATE_LIMITED' | 'UPSTREAM_ERROR' | 'NOT_FOUND';
  constructor(message: string, status = 500, code: 'BAD_REQUEST' | 'RATE_LIMITED' | 'UPSTREAM_ERROR' | 'NOT_FOUND' = 'UPSTREAM_ERROR') {
    super(message);
    this.name = 'TmdbError';
    this.status = status;
    this.code = code;
  }
}

// Strictly allowlisted paths per docs/data-and-licensing.md
const ALLOWED_PATTERNS: RegExp[] = [
  /^\/search\/movie\?/,
  /^\/search\/person\?/,
  /^\/movie\/\d+\?/,
  /^\/movie\/\d+\/watch\/providers$/,
  /^\/person\/\d+\?/,
  /^\/watch\/providers\/movie\?/,
  /^\/watch\/providers\/regions$/,
  /^\/find\/[a-zA-Z0-9_]+\?/,
  /^\/trending\/movie\/week$/,
];

export function isPathAllowlisted(pathWithQuery: string): boolean {
  return ALLOWED_PATTERNS.some((pattern) => pattern.test(pathWithQuery));
}

export async function fetchTmdb<T = unknown>(pathWithQuery: string): Promise<T> {
  if (!isPathAllowlisted(pathWithQuery)) {
    throw new TmdbError(`Requested TMDB endpoint is not allowlisted: ${pathWithQuery}`, 403, 'BAD_REQUEST');
  }

  const token = getEnv('TMDB_READ_TOKEN');
  if (!token) {
    throw new TmdbError('TMDB_READ_TOKEN is not configured in environment', 500, 'UPSTREAM_ERROR');
  }

  const url = `${TMDB_BASE_URL}${pathWithQuery}`;
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      if (res.status === 429) {
        if (attempts >= maxAttempts) {
          throw new TmdbError('TMDB rate limit exceeded', 429, 'RATE_LIMITED');
        }
        const retryAfter = Number(res.headers.get('Retry-After')) || 1;
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (res.status === 404) {
        throw new TmdbError(`TMDB resource not found: ${pathWithQuery}`, 404, 'NOT_FOUND');
      }

      if (!res.ok) {
        const errorText = await res.text();
        throw new TmdbError(`TMDB upstream error (${res.status}): ${errorText}`, res.status, 'UPSTREAM_ERROR');
      }

      return (await res.json()) as T;
    } catch (err: unknown) {
      if (err instanceof TmdbError) throw err;
      if (attempts >= maxAttempts) {
        throw new TmdbError(err instanceof Error ? err.message : 'Unknown TMDB fetch error', 502, 'UPSTREAM_ERROR');
      }
      await new Promise((r) => setTimeout(r, 500 * attempts));
    }
  }

  throw new TmdbError('Failed to fetch from TMDB after multiple attempts', 502, 'UPSTREAM_ERROR');
}
