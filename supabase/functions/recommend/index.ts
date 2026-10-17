// supabase/functions/recommend/index.ts
import {
  DEFAULT_DISCOVERY_DIAL,
  MMR_LAMBDA_DEFAULT,
  mmrRerank,
  passesQualityFloor,
  recommendRequestSchema,
  scoreCandidate,
  type RecommendedMovie,
  type ScoringAnchor,
  type ScoringCandidate,
  type ScoringUserContext,
  type WatchProvidersRegion,
} from '@tonight/shared';
import { authenticateRequest, AuthError } from '../_shared/auth.ts';
import { corsHeaders, errorResponse, handleCors, jsonResponse } from '../_shared/cors.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { fetchTmdb } from '../_shared/tmdb.ts';

interface CandidateMovieRow {
  id: number;
  tmdb_id: number | null;
  title: string | null;
  year: number | null;
  runtime_min: number | null;
  genres: string[];
  subjects: string[];
  settings: string[];
  series_qid: string | null;
  imdb_rating: number | null;
  imdb_votes: number | null;
  popularity_pct: number | null;
  has_story: boolean;
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return errorResponse('BAD_REQUEST', 'Method not allowed', 405);
  }

  try {
    const auth = await authenticateRequest(req);
    const body = await req.json().catch(() => ({}));
    const parseResult = recommendRequestSchema.safeParse(body);

    if (!parseResult.success) {
      return errorResponse('BAD_REQUEST', parseResult.error.message, 400);
    }

    const payload = parseResult.data;

    // Fetch user profile
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('discovery_dial, region')
      .eq('user_id', auth.userId)
      .single();

    const discoveryDial = profile?.discovery_dial ?? DEFAULT_DISCOVERY_DIAL;
    const region = profile?.region ?? 'IN';

    // Helper to hydrate posters from tmdb_cache or live fetch
    async function hydratePosters(movies: Array<{ tmdbId: number }>): Promise<Map<number, string | null>> {
      const tmdbIds = Array.from(new Set(movies.map((m) => m.tmdbId).filter((id) => id > 0)));
      if (tmdbIds.length === 0) return new Map();

      const { data: cached } = await supabaseAdmin
        .from('tmdb_cache')
        .select('tmdb_id, details')
        .in('tmdb_id', tmdbIds);

      const map = new Map<number, string | null>();
      for (const row of cached || []) {
        const details = row.details as Record<string, any>;
        map.set(row.tmdb_id, details?.poster_path ?? null);
      }
      return map;
    }

    // =========================================================================
    // MODE: HOME
    // =========================================================================
    if (payload.mode === 'home') {
      const cacheKey = 'home';

      // 1. Check rec_cache (TTL 24 hours)
      if (!payload.forceRefresh) {
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

      // 2. Fetch user anchors
      const { data: anchorRows } = await supabaseAdmin.rpc('user_anchors', {
        uid: auth.userId,
        max_n: 40,
      });

      const anchors = (anchorRows || []) as Array<{
        movie_id: number;
        weight: number;
        has_story: boolean;
      }>;

      const positiveAnchors = anchors.filter((a) => a.weight > 0 && a.has_story);
      const isColdStart = positiveAnchors.length < 3;

      // Fetch titles for anchors
      const anchorIds = anchors.map((a) => a.movie_id);
      const { data: anchorMovies } = await supabaseAdmin
        .from('movies')
        .select('id, title, genres, subjects, settings')
        .in('id', anchorIds.length > 0 ? anchorIds : [-1]);

      const anchorMetaMap = new Map<number, any>((anchorMovies || []).map((m: any) => [m.id, m]));
      const scoringAnchors: ScoringAnchor[] = anchors.map((a) => {
        const meta = anchorMetaMap.get(a.movie_id);
        return {
          movieId: a.movie_id,
          title: meta?.title ?? null,
          weight: a.weight,
          subjects: meta?.subjects ?? [],
          settings: meta?.settings ?? [],
        };
      });

      // 3. User exclusions: watched / watchlist / rec_feedback
      const { data: userTracks } = await supabaseAdmin
        .from('user_movies')
        .select('movie_id')
        .eq('user_id', auth.userId);
      const trackedIds = new Set<number>((userTracks || []).map((t: any) => t.movie_id as number));

      const { data: feedbackRows } = await supabaseAdmin
        .from('rec_feedback')
        .select('movie_id, kind, created_at')
        .eq('user_id', auth.userId);

      const excludedIds = new Set<number>(trackedIds);
      for (const fb of feedbackRows || []) {
        if (fb.kind === 'not_interested') {
          excludedIds.add(fb.movie_id);
        } else if (
          fb.kind === 'not_tonight' &&
          Date.now() - new Date(fb.created_at).getTime() < 14 * 86400 * 1000
        ) {
          excludedIds.add(fb.movie_id);
        }
      }

      // 4. Favourite people
      const { data: favPeople } = await supabaseAdmin
        .from('favourite_people')
        .select('person_id, people(name)')
        .eq('user_id', auth.userId);

      const favPersonIds = (favPeople || []).map((fp: any) => fp.person_id as number);
      const favPersonNames = new Map((favPeople || []).map((fp: any) => [fp.person_id as number, fp.people?.name as string]));

      // 5. Generate candidates
      let candidateIds: number[] = [];

      if (!isColdStart) {
        const posIds = positiveAnchors.map((a) => a.movie_id);
        const { data: candRows } = await supabaseAdmin.rpc('rec_candidates', {
          anchor_ids: posIds,
          per_anchor: 40,
        });
        candidateIds = Array.from(new Set((candRows || []).map((c: any) => c.movie_id as number)));
      } else {
        const { data: popularMovies } = await supabaseAdmin
          .from('movies')
          .select('id')
          .eq('has_story', true)
          .order('popularity_pct', { ascending: false, nullsFirst: false })
          .limit(100);
        candidateIds = (popularMovies || []).map((m: any) => m.id as number);
      }

      // Add favourite people candidates
      if (favPersonIds.length > 0) {
        const { data: peopleMovies } = await supabaseAdmin.rpc('movies_by_people', {
          person_ids: favPersonIds,
          max_n: 60,
        });
        for (const pm of peopleMovies || []) {
          candidateIds.push(pm.movie_id);
        }
      }

      // Filter out exclusions
      const filteredCandidateIds = Array.from(new Set(candidateIds)).filter(
        (id) => !excludedIds.has(id)
      );

      // Fetch candidate details
      const { data: candidateData } = await supabaseAdmin
        .from('movies')
        .select('id, tmdb_id, title, year, runtime_min, genres, subjects, settings, series_qid, imdb_rating, imdb_votes, popularity_pct, has_story')
        .in('id', filteredCandidateIds.length > 0 ? filteredCandidateIds.slice(0, 500) : [-1]);

      const candidates = (candidateData || []) as CandidateMovieRow[];

      // Fetch people credits for candidates
      const candidateIdList = candidates.map((c) => c.id);
      const { data: credits } = await supabaseAdmin
        .from('movie_people')
        .select('movie_id, person_id, role')
        .in('movie_id', candidateIdList.length > 0 ? candidateIdList : [-1]);

      const movieDirectorsMap = new Map<number, number[]>();
      const movieCastMap = new Map<number, number[]>();
      for (const cr of credits || []) {
        if (cr.role === 'director') {
          const list = movieDirectorsMap.get(cr.movie_id) || [];
          list.push(cr.person_id);
          movieDirectorsMap.set(cr.movie_id, list);
        } else if (cr.role === 'cast') {
          const list = movieCastMap.get(cr.movie_id) || [];
          list.push(cr.person_id);
          movieCastMap.set(cr.movie_id, list);
        }
      }

      // Fetch exact similarity matrix
      const allAnchorIds = scoringAnchors.map((a) => a.movieId);
      const { data: simRows } = await supabaseAdmin.rpc('sim_matrix', {
        candidate_ids: candidateIdList,
        anchor_ids: allAnchorIds,
      });

      // Map: candidateId -> (anchorId -> sim)
      const simMap = new Map<number, Record<number, number>>();
      for (const row of (simRows || []) as Array<{ movie_id: number; anchor_id: number; sim: number }>) {
        let inner = simMap.get(row.movie_id);
        if (!inner) {
          inner = {};
          simMap.set(row.movie_id, inner);
        }
        inner[row.anchor_id] = row.sim;
      }

      const userContext: ScoringUserContext = {
        anchors: scoringAnchors,
        favouritePersonIds: favPersonIds,
        discoveryDial,
      };

      interface EnrichedScored {
        candidate: CandidateMovieRow;
        score: number;
        explanation: {
          becauseMovieId: number | null;
          becauseTitle: string | null;
          sharedThemes: string[];
          personName?: string;
        };
        directors: number[];
        sims: Record<number, number>;
      }

      const scoredPool: EnrichedScored[] = [];

      for (const c of candidates) {
        const sims = simMap.get(c.id) || {};
        let maxAnchorSim = 0;
        for (const sim of Object.values(sims)) {
          if (sim > maxAnchorSim) maxAnchorSim = sim;
        }

        const dirs = movieDirectorsMap.get(c.id) || [];
        const cast = movieCastMap.get(c.id) || [];
        const favDir = dirs.some((d) => favPersonIds.includes(d));
        const favCastHit = cast.find((p) => favPersonIds.includes(p));
        const hasFavPerson = favDir || Boolean(favCastHit);
        const favPersonName = favDir
          ? favPersonNames.get(dirs.find((d) => favPersonIds.includes(d))!)
          : favCastHit
            ? favPersonNames.get(favCastHit)
            : undefined;

        if (
          !passesQualityFloor({
            imdbRating: c.imdb_rating,
            imdbVotes: c.imdb_votes,
            maxAnchorSim,
            favouritePersonHit: hasFavPerson,
          })
        ) {
          continue;
        }

        const scoringCand: ScoringCandidate = {
          movieId: c.id,
          title: c.title,
          seriesQid: c.series_qid,
          subjects: c.subjects,
          settings: c.settings,
          directorIds: dirs,
          castIds: cast,
          popularityPct: c.popularity_pct ?? 0.5,
          anchorSimilarities: sims,
        };

        const scored = scoreCandidate(scoringCand, userContext);

        scoredPool.push({
          candidate: c,
          score: scored.score,
          explanation: {
            ...scored.explanation,
            personName: favPersonName || undefined,
          },
          directors: dirs,
          sims,
        });
      }

      scoredPool.sort((a, b) => b.score - a.score);

      // Hydrate poster paths
      const posterMap = await hydratePosters(
        scoredPool.map((s) => ({ tmdbId: s.candidate.tmdb_id || 0 }))
      );

      const toRecommended = (sc: EnrichedScored): RecommendedMovie => ({
        movieId: sc.candidate.id,
        tmdbId: sc.candidate.tmdb_id || 0,
        title: sc.candidate.title || '',
        year: sc.candidate.year,
        posterPath: posterMap.get(sc.candidate.tmdb_id || 0) ?? null,
        backdropPath: null,
        genres: sc.candidate.genres,
        runtimeMin: sc.candidate.runtime_min,
        hasStory: sc.candidate.has_story,
        score: sc.score,
        explanation: sc.explanation,
      });

      const rows: Array<{ id: string; title: string; subtitle?: string; items: RecommendedMovie[] }> = [];

      // Row 1: Top picks (MMR)
      const topPicksInput = scoredPool.slice(0, 50).map((s) => ({
        movieId: s.candidate.id,
        score: s.score,
        seriesQid: s.candidate.series_qid,
        directorIds: s.directors,
      }));

      const top50Ids = topPicksInput.map((c) => c.movieId);
      const { data: candSimData } = await supabaseAdmin.rpc('sim_matrix', {
        candidate_ids: top50Ids,
        anchor_ids: top50Ids,
      });

      const candSimMap = new Map<string, number>();
      for (const row of (candSimData || []) as any[]) {
        candSimMap.set(`${row.movie_id}:${row.anchor_id}`, row.sim);
      }

      const mmrSelected = mmrRerank(
        topPicksInput,
        (a, b) => candSimMap.get(`${a.movieId}:${b.movieId}`) ?? 0,
        MMR_LAMBDA_DEFAULT,
        20
      );

      const scoredMap = new Map(scoredPool.map((s) => [s.candidate.id, s]));
      const topPickItems = mmrSelected
        .map((item) => scoredMap.get(item.movieId))
        .filter((sc): sc is EnrichedScored => Boolean(sc))
        .map(toRecommended);

      rows.push({
        id: 'top_picks',
        title: 'Top picks for you',
        subtitle: isColdStart ? 'Popular films to calibrate your taste' : 'Story matches aligned with your taste',
        items: topPickItems,
      });

      // Row 2-4: "Because you loved X"
      const seedAnchors = scoringAnchors.filter((a) => a.weight >= 1.0).slice(0, 3);
      let anchorRowIndex = 1;
      for (const sa of seedAnchors) {
        const matching = scoredPool
          .filter((sc) => (sc.sims[sa.movieId] ?? 0) >= 0.70)
          .sort((a, b) => (b.sims[sa.movieId] ?? 0) - (a.sims[sa.movieId] ?? 0))
          .slice(0, 15);

        if (matching.length >= 3) {
          rows.push({
            id: `because_${anchorRowIndex++}`,
            title: `Because you loved ${sa.title || 'this'}`,
            items: matching.map(toRecommended),
          });
        }
      }

      // Row 5: Hidden Gems
      const gems = scoredPool
        .filter(
          (sc) =>
            (sc.candidate.popularity_pct ?? 0) <= 0.40 &&
            (sc.candidate.imdb_rating ?? 0) >= 6.5
        )
        .slice(0, 15);

      if (gems.length >= 3) {
        rows.push({
          id: 'hidden_gems',
          title: 'Hidden gems for your taste',
          subtitle: 'Lesser-known stories with exceptional acclaim',
          items: gems.map(toRecommended),
        });
      }

      // Row 6: Crowd Pleasers
      const crowd = scoredPool
        .filter((sc) => (sc.candidate.popularity_pct ?? 0) >= 0.75)
        .slice(0, 15);

      if (crowd.length >= 3) {
        rows.push({
          id: 'crowd_pleasers',
          title: 'Popular & your kind of story',
          items: crowd.map(toRecommended),
        });
      }

      const responsePayload = {
        discoveryDial,
        coldStart: isColdStart,
        rows,
      };

      await supabaseAdmin.from('rec_cache').upsert({
        user_id: auth.userId,
        key: cacheKey,
        payload: responsePayload,
        created_at: new Date().toISOString(),
      });

      return jsonResponse(responsePayload);
    }

    // =========================================================================
    // MODE: SIMILAR
    // =========================================================================
    if (payload.mode === 'similar') {
      const { data: seedMovie } = await supabaseAdmin
        .from('movies')
        .select('id, title, genres, subjects, settings')
        .eq('id', payload.movieId)
        .single();

      if (!seedMovie) {
        return errorResponse('NOT_FOUND', 'Seed movie not found', 404);
      }

      const { data: similarRows } = await supabaseAdmin.rpc('similar_movies', {
        mid: payload.movieId,
        k: 25,
      });

      const candIds = (similarRows || []).map((r: any) => r.movie_id as number);
      const simLookup = new Map<number, number>((similarRows || []).map((r: any) => [r.movie_id as number, r.sim as number]));

      const { data: candidates } = await supabaseAdmin
        .from('movies')
        .select('id, tmdb_id, title, year, runtime_min, genres, subjects, settings, series_qid, imdb_rating, imdb_votes, popularity_pct, has_story')
        .in('id', candIds.length > 0 ? candIds : [-1]);

      const posterMap = await hydratePosters(
        (candidates || []).map((c: any) => ({ tmdbId: c.tmdb_id || 0 }))
      );

      const items: RecommendedMovie[] = (candidates || [])
        .map((c: any) => {
          const sim: number = Number(simLookup.get(c.id) ?? 0);
          return {
            movieId: c.id,
            tmdbId: c.tmdb_id || 0,
            title: c.title || '',
            year: c.year,
            posterPath: posterMap.get(c.tmdb_id || 0) ?? null,
            backdropPath: null,
            genres: c.genres,
            runtimeMin: c.runtime_min,
            hasStory: c.has_story,
            score: sim,
            explanation: {
              becauseMovieId: seedMovie.id,
              becauseTitle: seedMovie.title,
              sharedThemes: (c.subjects || []).slice(0, 3),
            },
          };
        })
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 15);

      return jsonResponse({ items });
    }

    // =========================================================================
    // MODE: TONIGHT
    // =========================================================================
    if (payload.mode === 'tonight') {
      const excludeIds = new Set<number>(payload.excludeMovieIds || []);

      const { data: recentFb } = await supabaseAdmin
        .from('rec_feedback')
        .select('movie_id')
        .eq('user_id', auth.userId)
        .eq('kind', 'not_tonight')
        .gt('created_at', new Date(Date.now() - 14 * 86400 * 1000).toISOString());

      for (const fb of recentFb || []) {
        excludeIds.add(fb.movie_id);
      }

      const { data: watchedRows } = await supabaseAdmin
        .from('user_movies')
        .select('movie_id')
        .eq('user_id', auth.userId)
        .eq('status', 'watched');

      for (const w of watchedRows || []) {
        excludeIds.add(w.movie_id);
      }

      const { data: watchlistRows } = await supabaseAdmin
        .from('user_movies')
        .select('movie_id')
        .eq('user_id', auth.userId)
        .eq('status', 'watchlist');
      const watchlistIds = new Set<number>((watchlistRows || []).map((w: any) => w.movie_id as number));

      let query = supabaseAdmin
        .from('movies')
        .select('id, tmdb_id, title, year, runtime_min, genres, subjects, settings, series_qid, imdb_rating, imdb_votes, popularity_pct, has_story')
        .eq('has_story', true)
        .order('popularity_pct', { ascending: false, nullsFirst: false })
        .limit(150);

      if (payload.maxRuntime) {
        query = query.lte('runtime_min', payload.maxRuntime);
      }

      const { data: rawCandidates } = await query;
      const candidates = ((rawCandidates || []) as CandidateMovieRow[]).filter((c) => !excludeIds.has(c.id));

      let moodEmbedding: string | null = null;
      if (payload.moodId) {
        const { data: mood } = await supabaseAdmin
          .from('moods')
          .select('embedding')
          .eq('id', payload.moodId)
          .single();
        moodEmbedding = mood?.embedding || null;
      }

      let moodSimMap = new Map<number, number>();
      if (moodEmbedding) {
        const { data: moodSims } = await supabaseAdmin.rpc('candidates_near_vector', {
          q: moodEmbedding,
          k: 150,
        });
        moodSimMap = new Map((moodSims || []).map((m: any) => [m.movie_id as number, m.sim as number]));
      }

      let allowedMovieIds: Set<number> | null = null;
      if (payload.onlyMyServices) {
        const { data: userProviders } = await supabaseAdmin
          .from('user_providers')
          .select('provider_id')
          .eq('user_id', auth.userId);
        const myProviderIds = new Set((userProviders || []).map((p: any) => p.provider_id));

        const tmdbIds = candidates.map((c) => c.tmdb_id).filter((id): id is number => Boolean(id));
        const { data: cachedCands } = await supabaseAdmin
          .from('tmdb_cache')
          .select('tmdb_id, providers')
          .in('tmdb_id', tmdbIds);

        allowedMovieIds = new Set<number>();
        for (const row of cachedCands || []) {
          const provs = (row.providers as Record<string, any>)?.[region];
          const flatrate = (provs?.flatrate || []).map((p: any) => p.provider_id);
          const free = (provs?.free || []).map((p: any) => p.provider_id);
          const available = [...flatrate, ...free];
          if (available.some((id: any) => myProviderIds.has(id))) {
            const matchMovie = candidates.find((c) => c.tmdb_id === row.tmdb_id);
            if (matchMovie) allowedMovieIds.add(matchMovie.id);
          }
        }
      }

      const poolToScore = allowedMovieIds
        ? candidates.filter((c) => allowedMovieIds!.has(c.id))
        : candidates;

      interface TonightScored {
        candidate: CandidateMovieRow;
        score: number;
      }

      const scoredTonight: TonightScored[] = [];
      for (const c of poolToScore) {
        let baseScore = c.popularity_pct ?? 0.5;
        if (watchlistIds.has(c.id)) {
          baseScore += 0.08;
        }

        let finalScore = baseScore;
        if (moodEmbedding) {
          const moodSim = moodSimMap.get(c.id) ?? 0.5;
          finalScore = 0.6 * baseScore + 0.4 * moodSim;
        }

        scoredTonight.push({ candidate: c, score: finalScore });
      }

      scoredTonight.sort((a, b) => b.score - a.score);

      const topCandidates = scoredTonight.slice(0, 3);
      if (topCandidates.length === 0) {
        return jsonResponse({ hero: null, alternatives: [] });
      }

      const heroCand = topCandidates[0]!;
      const altCands = topCandidates.slice(1, 3);

      const posterMap = await hydratePosters(
        topCandidates.map((tc) => ({ tmdbId: tc.candidate.tmdb_id || 0 }))
      );

      let heroOverview: string | null = null;
      let heroProviders: WatchProvidersRegion | null = null;
      let heroTrailer: string | null = null;

      if (heroCand.candidate.tmdb_id) {
        const { data: heroCache } = await supabaseAdmin
          .from('tmdb_cache')
          .select('details, providers')
          .eq('tmdb_id', heroCand.candidate.tmdb_id)
          .single();

        let details = heroCache?.details as Record<string, any>;
        let provs = heroCache?.providers as Record<string, any>;

        if (!details) {
          try {
            details = await fetchTmdb<any>(
              `/movie/${heroCand.candidate.tmdb_id}?append_to_response=videos,watch/providers&language=en-US`
            );
            provs = details['watch/providers']?.results || null;
            await supabaseAdmin.from('tmdb_cache').upsert({
              tmdb_id: heroCand.candidate.tmdb_id,
              details,
              details_fetched_at: new Date().toISOString(),
              providers: provs,
              providers_fetched_at: new Date().toISOString(),
            });
          } catch {
            // Non-fatal
          }
        }

        heroOverview = details?.overview || null;
        const trailer = (details?.videos?.results || []).find(
          (v: any) => v.site === 'YouTube' && v.type === 'Trailer'
        );
        heroTrailer = trailer?.key || null;

        const regData = provs?.[region];
        if (regData) {
          heroProviders = {
            region,
            justWatchLink: regData.link || null,
            flatrate: (regData.flatrate || []).map((p: any) => ({
              providerId: p.provider_id,
              providerName: p.provider_name,
              logoPath: p.logo_path,
            })),
            free: [...(regData.free || []), ...(regData.ads || [])].map((p: any) => ({
              providerId: p.provider_id,
              providerName: p.provider_name,
              logoPath: p.logo_path,
            })),
            rent: (regData.rent || []).map((p: any) => ({
              providerId: p.provider_id,
              providerName: p.provider_name,
              logoPath: p.logo_path,
            })),
            buy: (regData.buy || []).map((p: any) => ({
              providerId: p.provider_id,
              providerName: p.provider_name,
              logoPath: p.logo_path,
            })),
            attribution: 'JustWatch' as const,
          };
        }
      }

      const formatRec = (sc: TonightScored): RecommendedMovie => ({
        movieId: sc.candidate.id,
        tmdbId: sc.candidate.tmdb_id || 0,
        title: sc.candidate.title || '',
        year: sc.candidate.year,
        posterPath: posterMap.get(sc.candidate.tmdb_id || 0) ?? null,
        backdropPath: null,
        genres: sc.candidate.genres,
        runtimeMin: sc.candidate.runtime_min,
        hasStory: sc.candidate.has_story,
        score: sc.score,
        explanation: {
          becauseMovieId: null,
          becauseTitle: null,
          sharedThemes: (sc.candidate.subjects || []).slice(0, 3),
        },
      });

      return jsonResponse({
        hero: {
          ...formatRec(heroCand),
          overview: heroOverview,
          providers: heroProviders,
          trailerYoutubeKey: heroTrailer,
        },
        alternatives: altCands.map(formatRec),
      });
    }

    return errorResponse('BAD_REQUEST', 'Unknown recommendation mode');
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return errorResponse(err.code, err.message, 401);
    }
    console.error('recommend unhandled error:', err);
    return errorResponse('UPSTREAM_ERROR', err instanceof Error ? err.message : 'Internal error', 500);
  }
});
