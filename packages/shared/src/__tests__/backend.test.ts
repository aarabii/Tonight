import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANCHOR_WEIGHTS,
  RECENCY_DECAY_BASE,
  RECENCY_DECAY_FLOOR,
  SECONDS_PER_YEAR,
} from '../constants';

describe('Backend Migrations and Shared Constants Parity', () => {
  const rootDir = resolve(__dirname, '../../../../');
  const recsSql = readFileSync(
    resolve(rootDir, 'supabase/migrations/0006_recs.sql'),
    'utf-8'
  );
  const rlsSql = readFileSync(
    resolve(rootDir, 'supabase/migrations/0007_rls.sql'),
    'utf-8'
  );

  it('verifies SQL user_anchors weights match TypeScript ANCHOR_WEIGHTS', () => {
    // favourite
    expect(recsSql).toContain(`when um.is_favourite then ${ANCHOR_WEIGHTS.favourite.toFixed(1)}`);
    // loved
    expect(recsSql).toContain(`when 'loved' then ${ANCHOR_WEIGHTS.loved.toFixed(1)}`);
    // liked
    expect(recsSql).toContain(`when 'liked' then ${ANCHOR_WEIGHTS.liked.toFixed(1)}`);
    // watchlist
    expect(recsSql).toContain(`when um.status = 'watchlist' then ${ANCHOR_WEIGHTS.watchlist}`);
    // meh
    expect(recsSql).toContain(`when 'meh' then ${ANCHOR_WEIGHTS.meh.toFixed(1)}`);
    // disliked
    expect(recsSql).toContain(`when 'disliked' then ${ANCHOR_WEIGHTS.disliked.toFixed(1)}`);
    // rec_feedback more_like_this
    expect(recsSql).toContain(`when 'more_like_this' then ${ANCHOR_WEIGHTS.more_like_this.toFixed(1)}`);
    // rec_feedback not_interested
    expect(recsSql).toContain(`when 'not_interested' then ${ANCHOR_WEIGHTS.not_interested.toFixed(1)}`);
  });

  it('verifies SQL recency decay parameters match TypeScript constants', () => {
    expect(recsSql).toContain(`greatest(${RECENCY_DECAY_FLOOR.toFixed(1)}, power(${RECENCY_DECAY_BASE.toFixed(1)}`);
    expect(recsSql).toContain(`${SECONDS_PER_YEAR.toFixed(1)}`);
  });

  it('verifies RLS is enabled on all user, social, recs, and cache tables', () => {
    const requiredRlsTables = [
      'profiles',
      'user_movies',
      'favourite_people',
      'rec_feedback',
      'user_providers',
      'follows',
      'rec_cache',
      'tmdb_cache',
      'tmdb_person_cache',
      'tmdb_search_cache',
    ];

    for (const table of requiredRlsTables) {
      expect(rlsSql).toContain(`alter table public.${table} enable row level security;`);
    }
  });

  it('verifies tmdb display caches revoke direct access from anon', () => {
    expect(rlsSql).toContain('revoke all on public.tmdb_cache from anon;');
    expect(rlsSql).toContain('revoke all on public.tmdb_person_cache from anon;');
    expect(rlsSql).toContain('revoke all on public.tmdb_search_cache from anon;');
    expect(rlsSql).toContain('revoke all on public.user_movies from anon;');
    expect(rlsSql).toContain('revoke all on public.profiles from anon;');
  });
});

describe('TMDB Allowlist Security Rules', () => {
  // Test regexes from supabase/functions/_shared/tmdb.ts
  const ALLOWED_PATTERNS = [
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

  function isAllowed(path: string): boolean {
    return ALLOWED_PATTERNS.some((p) => p.test(path));
  }

  it('allows valid TMDB API paths', () => {
    expect(isAllowed('/search/movie?query=Inception&page=1')).toBe(true);
    expect(isAllowed('/search/person?query=Nolan&page=1')).toBe(true);
    expect(isAllowed('/movie/550?append_to_response=credits')).toBe(true);
    expect(isAllowed('/movie/550/watch/providers')).toBe(true);
    expect(isAllowed('/person/525?append_to_response=movie_credits')).toBe(true);
    expect(isAllowed('/watch/providers/movie?watch_region=IN')).toBe(true);
    expect(isAllowed('/watch/providers/regions')).toBe(true);
    expect(isAllowed('/find/tt0111161?external_source=imdb_id')).toBe(true);
    expect(isAllowed('/trending/movie/week')).toBe(true);
  });

  it('strictly blocks unapproved or malicious TMDB paths', () => {
    expect(isAllowed('/account/123')).toBe(false);
    expect(isAllowed('/authentication/token/new')).toBe(false);
    expect(isAllowed('/configuration')).toBe(false);
    expect(isAllowed('/movie/550/rating')).toBe(false);
    expect(isAllowed('/tv/123')).toBe(false);
    expect(isAllowed('/collection/10')).toBe(false);
  });
});
