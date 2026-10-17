// supabase/functions/vibe-search/index.ts
import { vibeSearchRequestSchema, type RecommendedMovie } from '@tonight/shared';
import { authenticateRequest, AuthError } from '../_shared/auth.ts';
import { corsHeaders, errorResponse, handleCors, jsonResponse } from '../_shared/cors.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

declare const Supabase: any;

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return errorResponse('BAD_REQUEST', 'Method not allowed', 405);
  }

  try {
    await authenticateRequest(req);
    const body = await req.json().catch(() => ({}));
    const parseResult = vibeSearchRequestSchema.safeParse(body);

    if (!parseResult.success) {
      return errorResponse('BAD_REQUEST', parseResult.error.message, 400);
    }

    const { query } = parseResult.data;

    let candidateRows: any[] = [];

    // Attempt Supabase.ai Session embedding if available in Edge runtime
    let embedded = false;
    if (typeof Supabase !== 'undefined' && Supabase.ai?.Session) {
      try {
        const session = new Supabase.ai.Session('gte-small');
        const vector = await session.run(query, { mean_pool: true, normalize: true });
        const vectorStr = `[${Array.from(vector).join(',')}]`;

        const { data: vCands } = await supabaseAdmin.rpc('candidates_near_vector', {
          q: vectorStr as any,
          k: 30,
        });

        if (vCands && vCands.length > 0) {
          const ids = vCands.map((c: any) => c.movie_id);
          const { data: movies } = await supabaseAdmin
            .from('movies')
            .select('id, tmdb_id, title, year, runtime_min, genres, subjects, settings, series_qid, imdb_rating, imdb_votes, popularity_pct, has_story')
            .in('id', ids);

          const simMap = new Map((vCands as any[]).map((c: any) => [c.movie_id, c.sim]));
          candidateRows = (movies || []).map((m: any) => ({
            ...m,
            score: simMap.get(m.id) ?? 0.5,
          }));
          embedded = true;
        }
      } catch {
        embedded = false;
      }
    }

    // Fallback if Supabase.ai not in local runtime: full text search on title, genres, and subjects
    if (!embedded) {
      const sanitized = query.replace(/[^\w\s]/g, '').trim();
      const { data: ftsMovies } = await supabaseAdmin
        .from('movies')
        .select('id, tmdb_id, title, year, runtime_min, genres, subjects, settings, series_qid, imdb_rating, imdb_votes, popularity_pct, has_story')
        .or(`title.ilike.%${sanitized}%,genres.cs.{${sanitized}},subjects.cs.{${sanitized}}`)
        .order('popularity_pct', { ascending: false, nullsFirst: false })
        .limit(25);

      candidateRows = (ftsMovies || []).map((m: any) => ({
        ...m,
        score: m.popularity_pct ?? 0.5,
      }));
    }

    // Hydrate posters
    const tmdbIds = candidateRows.map((m) => m.tmdb_id).filter((id): id is number => Boolean(id));
    const { data: cachedPosters } = await supabaseAdmin
      .from('tmdb_cache')
      .select('tmdb_id, details')
      .in('tmdb_id', tmdbIds.length > 0 ? tmdbIds : [-1]);

    const posterMap = new Map<number, string | null>();
    for (const cp of cachedPosters || []) {
      posterMap.set(cp.tmdb_id, (cp.details as Record<string, any>)?.poster_path ?? null);
    }

    const items: RecommendedMovie[] = candidateRows.slice(0, 25).map((m) => ({
      movieId: m.id,
      tmdbId: m.tmdb_id || 0,
      title: m.title || '',
      year: m.year,
      posterPath: posterMap.get(m.tmdb_id || 0) ?? null,
      backdropPath: null,
      genres: m.genres || [],
      runtimeMin: m.runtime_min,
      hasStory: m.has_story,
      score: m.score,
      explanation: {
        becauseMovieId: null,
        becauseTitle: null,
        sharedThemes: (m.subjects || []).slice(0, 3),
      },
    }));

    return jsonResponse({ items });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return errorResponse(err.code, err.message, 401);
    }
    console.error('vibe-search unhandled error:', err);
    return errorResponse('UPSTREAM_ERROR', err instanceof Error ? err.message : 'Internal error', 500);
  }
});
