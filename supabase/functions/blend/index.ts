// supabase/functions/blend/index.ts
import {
  blendHarmonicScore,
  blendRequestSchema,
  tasteMatchPercent,
  type RecommendedMovie,
} from '@tonight/shared';
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
    const parseResult = blendRequestSchema.safeParse(body);

    if (!parseResult.success) {
      return errorResponse('BAD_REQUEST', parseResult.error.message, 400);
    }

    const { friendUsername, forceRefresh } = parseResult.data;

    // 1. Look up friend profile
    const { data: friendProfile } = await supabaseAdmin
      .from('profiles')
      .select('user_id, username, display_name, avatar_url')
      .eq('username', friendUsername)
      .single();

    if (!friendProfile) {
      return errorResponse('NOT_FOUND', `User @${friendUsername} not found`, 404);
    }

    if (friendProfile.user_id === auth.userId) {
      return errorResponse('BAD_REQUEST', 'Cannot blend with yourself', 400);
    }

    // 2. Auth check: Mutual friendship required
    const { data: isMutual } = await supabaseAdmin.rpc('is_mutual', {
      a: auth.userId,
      b: friendProfile.user_id,
    });

    if (!isMutual) {
      return errorResponse(
        'FORBIDDEN',
        `You and @${friendUsername} must follow each other to create a Taste Blend`,
        403
      );
    }

    const cacheKey = `blend:${friendProfile.user_id}`;

    // 3. Check rec_cache
    if (!forceRefresh) {
      const { data: cached } = await supabaseAdmin
        .from('rec_cache')
        .select('payload, created_at')
        .eq('user_id', auth.userId)
        .eq('key', cacheKey)
        .single();

      if (cached && Date.now() - new Date(cached.created_at).getTime() < 24 * 3600 * 1000) {
        return jsonResponse(cached.payload);
      }
    }

    // 4. Fetch anchors for both users
    const [anchorsARes, anchorsBRes] = await Promise.all([
      supabaseAdmin.rpc('user_anchors', { uid: auth.userId, max_n: 40 }),
      supabaseAdmin.rpc('user_anchors', { uid: friendProfile.user_id, max_n: 40 }),
    ]);

    const anchorsA = (anchorsARes.data || []) as Array<{ movie_id: number; weight: number; has_story: boolean }>;
    const anchorsB = (anchorsBRes.data || []) as Array<{ movie_id: number; weight: number; has_story: boolean }>;

    // Fetch watched movies for both users
    const [watchedARes, watchedBRes] = await Promise.all([
      supabaseAdmin.from('user_movies').select('movie_id, reaction, is_favourite').eq('user_id', auth.userId),
      supabaseAdmin.from('user_movies').select('movie_id, reaction, is_favourite').eq('user_id', friendProfile.user_id),
    ]);

    const watchedA = new Set<number>((watchedARes.data || []).map((w: any) => w.movie_id as number));
    const watchedB = new Set<number>((watchedBRes.data || []).map((w: any) => w.movie_id as number));

    // Calculate taste match % using anchor overlap
    const posAIds = new Set(anchorsA.filter((a) => a.weight > 0).map((a) => a.movie_id));
    const posBIds = new Set(anchorsB.filter((a) => a.weight > 0).map((a) => a.movie_id));
    const intersection = [...posAIds].filter((id) => posBIds.has(id)).length;
    const union = new Set([...posAIds, ...posBIds]).size;
    const jaccard = union > 0 ? intersection / union : 0.5;
    // Map jaccard to simulated cosine [0.5, 0.95]
    const estimatedCosine = 0.5 + jaccard * 0.45;
    const tasteMatchPct = tasteMatchPercent(estimatedCosine);

    // Candidates: rec_candidates from top positive anchors
    const topAnchorIds = Array.from(
      new Set([
        ...anchorsA.filter((a) => a.weight > 0).slice(0, 5).map((a) => a.movie_id),
        ...anchorsB.filter((a) => a.weight > 0).slice(0, 5).map((a) => a.movie_id),
      ])
    );

    const { data: candRows } = await supabaseAdmin.rpc('rec_candidates', {
      anchor_ids: topAnchorIds.length > 0 ? topAnchorIds : [-1],
      per_anchor: 30,
    });

    const candidateIds = Array.from(new Set((candRows || []).map((c: any) => c.movie_id as number)));

    // Fetch movies metadata
    const { data: moviesData } = await supabaseAdmin
      .from('movies')
      .select('id, tmdb_id, title, year, runtime_min, genres, subjects, settings, series_qid, imdb_rating, imdb_votes, popularity_pct, has_story')
      .in('id', candidateIds.length > 0 ? candidateIds : [-1]);

    const movieMap = new Map<number, any>((moviesData || []).map((m: any) => [m.id, m]));

    // Poster hydration
    const tmdbIds = (moviesData || []).map((m: any) => m.tmdb_id).filter((id: any): id is number => Boolean(id));
    const { data: cachedPosters } = await supabaseAdmin
      .from('tmdb_cache')
      .select('tmdb_id, details')
      .in('tmdb_id', tmdbIds);

    const posterMap = new Map<number, string | null>();
    for (const cp of cachedPosters || []) {
      posterMap.set(cp.tmdb_id, (cp.details as Record<string, any>)?.poster_path ?? null);
    }

    const formatMovie = (m: any, score: number): RecommendedMovie => ({
      movieId: m.id,
      tmdbId: m.tmdb_id || 0,
      title: m.title || '',
      year: m.year,
      posterPath: posterMap.get(m.tmdb_id || 0) ?? null,
      backdropPath: null,
      genres: m.genres || [],
      runtimeMin: m.runtime_min,
      hasStory: m.has_story,
      score,
      explanation: {
        becauseMovieId: null,
        becauseTitle: null,
        sharedThemes: (m.subjects || []).slice(0, 3),
      },
    });

    // Row 1: For both of you (exclude anything watched by A or B)
    const forBothOfYou: RecommendedMovie[] = [];
    for (const id of candidateIds) {
      const numId = Number(id);
      if (watchedA.has(numId) || watchedB.has(numId)) continue;
      const m = movieMap.get(numId);
      if (!m) continue;
      const popScore = Number(m.popularity_pct ?? 0.5);
      const hScore = blendHarmonicScore(popScore, popScore);
      forBothOfYou.push(formatMovie(m, hScore));
      if (forBothOfYou.length >= 15) break;
    }

    // Row 2: They loved it for you (B loved/favourite, A not watched)
    const bLovedIds = (watchedBRes.data || [])
      .filter((w: any) => (w.reaction === 'loved' || w.is_favourite) && !watchedA.has(w.movie_id))
      .map((w: any) => w.movie_id as number);

    const { data: bLovedMovies } = await supabaseAdmin
      .from('movies')
      .select('id, tmdb_id, title, year, runtime_min, genres, subjects, settings, series_qid, imdb_rating, imdb_votes, popularity_pct, has_story')
      .in('id', bLovedIds.length > 0 ? bLovedIds.slice(0, 15) : [-1]);

    const theyLovedForYou = (bLovedMovies || []).map((m: any) => formatMovie(m, 0.9));

    // Row 3: You loved it for them (A loved/favourite, B not watched)
    const aLovedIds = (watchedARes.data || [])
      .filter((w: any) => (w.reaction === 'loved' || w.is_favourite) && !watchedB.has(w.movie_id))
      .map((w: any) => w.movie_id as number);

    const { data: aLovedMovies } = await supabaseAdmin
      .from('movies')
      .select('id, tmdb_id, title, year, runtime_min, genres, subjects, settings, series_qid, imdb_rating, imdb_votes, popularity_pct, has_story')
      .in('id', aLovedIds.length > 0 ? aLovedIds.slice(0, 15) : [-1]);

    const youLovedForThem = (aLovedMovies || []).map((m: any) => formatMovie(m, 0.9));

    const response = {
      friend: {
        userId: friendProfile.user_id,
        username: friendProfile.username,
        displayName: friendProfile.display_name,
        avatarUrl: friendProfile.avatar_url,
      },
      tasteMatchPct,
      sharedThemes: ['Cinema', 'Storytelling'],
      forBothOfYou,
      theyLovedForYou,
      youLovedForThem,
    };

    // Cache blend result
    await supabaseAdmin.from('rec_cache').upsert({
      user_id: auth.userId,
      key: cacheKey,
      payload: response,
      created_at: new Date().toISOString(),
    });

    return jsonResponse(response);
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return errorResponse(err.code, err.message, err.code === 'UNAUTHORIZED' ? 401 : 403);
    }
    console.error('blend unhandled error:', err);
    return errorResponse('UPSTREAM_ERROR', err instanceof Error ? err.message : 'Internal error', 500);
  }
});
