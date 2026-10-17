// supabase/functions/import-library/index.ts
import { importBatchRequestSchema, rating10ToReaction } from '@tonight/shared';
import { authenticateRequest, AuthError } from '../_shared/auth.ts';
import { corsHeaders, errorResponse, handleCors, jsonResponse } from '../_shared/cors.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return errorResponse('BAD_REQUEST', 'Method not allowed', 405);
  }

  try {
    const auth = await authenticateRequest(req);
    const body = await req.json().catch(() => ({}));
    const parseResult = importBatchRequestSchema.safeParse(body);

    if (!parseResult.success) {
      return errorResponse('BAD_REQUEST', parseResult.error.message, 400);
    }

    const { source, items } = parseResult.data;

    // Collect candidate lookups
    const imdbIds = items
      .map((it) => it.imdbId)
      .filter((id): id is string => Boolean(id));

    // 1. Batch lookup by imdb_id
    const { data: imdbMatched } = await supabaseAdmin
      .from('movies')
      .select('id, imdb_id')
      .in('imdb_id', imdbIds.length > 0 ? imdbIds : ['none']);

    const imdbMap = new Map<string, number>((imdbMatched || []).map((m: any) => [m.imdb_id as string, m.id as number]));

    // 2. For items not resolved by imdb_id, prepare title/year lookup
    const titlesToLookup = items
      .filter((it) => !it.imdbId || !imdbMap.has(it.imdbId))
      .map((it) => it.title.trim().toLowerCase());

    const { data: titleMatched } = await supabaseAdmin
      .from('movies')
      .select('id, title, year')
      .in('title', titlesToLookup.length > 0 ? titlesToLookup : ['none']);

    // Map: lower(title) + ':' + (year || '') -> movie.id
    const titleYearMap = new Map<string, number>();
    for (const m of (titleMatched || []) as any[]) {
      if (m.title) {
        const key = `${m.title.trim().toLowerCase()}:${m.year ?? ''}`;
        titleYearMap.set(key, m.id);
        const titleOnlyKey = m.title.trim().toLowerCase();
        if (!titleYearMap.has(titleOnlyKey)) {
          titleYearMap.set(titleOnlyKey, m.id);
        }
      }
    }

    const rowsToUpsert: Array<{
      user_id: string;
      movie_id: number;
      status: 'watched' | 'watchlist';
      reaction: 'loved' | 'liked' | 'meh' | 'disliked' | null;
      is_favourite: boolean;
      watched_on: string | null;
      source: 'letterboxd' | 'imdb';
      updated_at: string;
    }> = [];

    const unmatched: Array<{ title: string; year?: number | null }> = [];

    for (const item of items) {
      let movieId: number | undefined;

      // 1. Match by imdbId
      if (item.imdbId && imdbMap.has(item.imdbId)) {
        movieId = imdbMap.get(item.imdbId);
      }

      // 2. Match by title + year
      if (!movieId) {
        const titleKey = `${item.title.trim().toLowerCase()}:${item.year ?? ''}`;
        if (titleYearMap.has(titleKey)) {
          movieId = titleYearMap.get(titleKey);
        } else {
          const titleOnly = item.title.trim().toLowerCase();
          movieId = titleYearMap.get(titleOnly);
        }
      }

      if (movieId === undefined) {
        unmatched.push({
          title: item.title,
          year: item.year ?? null,
        });
        continue;
      }

      const reaction = item.status === 'watched' ? rating10ToReaction(item.rating10) : null;

      rowsToUpsert.push({
        user_id: auth.userId,
        movie_id: movieId,
        status: item.status,
        reaction,
        is_favourite: item.isFavourite ?? false,
        watched_on: item.watchedOn ?? null,
        source,
        updated_at: new Date().toISOString(),
      });
    }

    if (rowsToUpsert.length > 0) {
      for (let i = 0; i < rowsToUpsert.length; i += 50) {
        const chunk = rowsToUpsert.slice(i, i + 50);
        const { error } = await supabaseAdmin.from('user_movies').upsert(chunk, {
          onConflict: 'user_id,movie_id',
        });
        if (error) {
          throw new Error(`Failed to upsert user_movies batch: ${error.message}`);
        }
      }
    }

    return jsonResponse({
      importedCount: rowsToUpsert.length,
      unmatchedCount: unmatched.length,
      unmatched,
    });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return errorResponse(err.code, err.message, 401);
    }
    console.error('import-library unhandled error:', err);
    return errorResponse('UPSTREAM_ERROR', err instanceof Error ? err.message : 'Internal error', 500);
  }
});
