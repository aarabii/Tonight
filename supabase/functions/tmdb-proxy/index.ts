// supabase/functions/tmdb-proxy/index.ts
import { tmdbProxyRequestSchema } from '@tonight/shared';
import { authenticateRequest, AuthError } from '../_shared/auth.ts';
import { corsHeaders, errorResponse, handleCors, jsonResponse } from '../_shared/cors.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { fetchTmdb, TmdbError } from '../_shared/tmdb.ts';

interface TmdbSearchMovieResult {
  id: number;
  title: string;
  release_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genre_ids?: number[];
  overview?: string;
}

interface TmdbSearchPersonResult {
  id: number;
  name: string;
  known_for_department?: string;
  profile_path?: string | null;
  known_for?: Array<{ title?: string; name?: string }>;
}

interface TmdbMovieDetailsResult {
  id: number;
  title: string;
  original_title?: string;
  release_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genres?: Array<{ id: number; name: string }>;
  runtime?: number | null;
  tagline?: string | null;
  overview?: string | null;
  release_dates?: {
    results?: Array<{
      iso_3166_1: string;
      release_dates?: Array<{ certification?: string }>;
    }>;
  };
  credits?: {
    cast?: Array<{
      id: number;
      name: string;
      character: string;
      profile_path?: string | null;
    }>;
    crew?: Array<{
      id: number;
      name: string;
      job: string;
      profile_path?: string | null;
    }>;
  };
  videos?: {
    results?: Array<{
      site: string;
      type: string;
      key: string;
    }>;
  };
  'watch/providers'?: {
    results?: Record<
      string,
      {
        link?: string;
        flatrate?: Array<{ provider_id: number; provider_name: string; logo_path: string }>;
        free?: Array<{ provider_id: number; provider_name: string; logo_path: string }>;
        ads?: Array<{ provider_id: number; provider_name: string; logo_path: string }>;
        rent?: Array<{ provider_id: number; provider_name: string; logo_path: string }>;
        buy?: Array<{ provider_id: number; provider_name: string; logo_path: string }>;
      }
    >;
  };
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
    const parseResult = tmdbProxyRequestSchema.safeParse(body);

    if (!parseResult.success) {
      return errorResponse('BAD_REQUEST', parseResult.error.message, 400);
    }

    const payload = parseResult.data;

    // 1. search_movies
    if (payload.action === 'search_movies') {
      const page = payload.page || 1;
      const queryLower = payload.query.toLowerCase().trim();
      const queryKey = `movie:${queryLower}:${page}`;

      // Check cache (3-day TTL)
      const { data: cached } = await supabaseAdmin
        .from('tmdb_search_cache')
        .select('payload, fetched_at')
        .eq('query_key', queryKey)
        .single();

      if (cached && Date.now() - new Date(cached.fetched_at).getTime() < 3 * 86400 * 1000) {
        return jsonResponse(cached.payload);
      }

      const tmdbData = await fetchTmdb<{
        page: number;
        total_pages: number;
        results: TmdbSearchMovieResult[];
      }>(`/search/movie?query=${encodeURIComponent(payload.query)}&page=${page}&include_adult=false&language=en-US`);

      const tmdbIds = tmdbData.results.map((r) => r.id);
      const { data: dbMovies } = await supabaseAdmin
        .from('movies')
        .select('id, tmdb_id, has_story, genres, runtime_min')
        .in('tmdb_id', tmdbIds.length > 0 ? tmdbIds : [-1]);

      const dbMap = new Map<number, any>((dbMovies || []).map((m: any) => [m.tmdb_id, m]));

      const results = tmdbData.results.map((item) => {
        const dbMovie = dbMap.get(item.id);
        const year = item.release_date ? parseInt(item.release_date.slice(0, 4), 10) : null;
        return {
          movieId: dbMovie?.id ?? null,
          tmdbId: item.id,
          title: item.title,
          year: Number.isNaN(year) ? null : year,
          posterPath: item.poster_path ?? null,
          backdropPath: item.backdrop_path ?? null,
          genres: dbMovie?.genres ?? [],
          runtimeMin: dbMovie?.runtime_min ?? null,
          hasStory: dbMovie?.has_story ?? false,
        };
      });

      const responsePayload = {
        page: tmdbData.page,
        totalPages: tmdbData.total_pages,
        results,
      };

      await supabaseAdmin.from('tmdb_search_cache').upsert({
        query_key: queryKey,
        payload: responsePayload,
        fetched_at: new Date().toISOString(),
      });

      return jsonResponse(responsePayload);
    }

    // 2. search_people
    if (payload.action === 'search_people') {
      const page = payload.page || 1;
      const queryLower = payload.query.toLowerCase().trim();
      const queryKey = `person:${queryLower}:${page}`;

      const { data: cached } = await supabaseAdmin
        .from('tmdb_search_cache')
        .select('payload, fetched_at')
        .eq('query_key', queryKey)
        .single();

      if (cached && Date.now() - new Date(cached.fetched_at).getTime() < 3 * 86400 * 1000) {
        return jsonResponse(cached.payload);
      }

      const tmdbData = await fetchTmdb<{
        page: number;
        total_pages: number;
        results: TmdbSearchPersonResult[];
      }>(`/search/person?query=${encodeURIComponent(payload.query)}&page=${page}`);

      const tmdbPersonIds = tmdbData.results.map((r) => r.id);
      const { data: dbPeople } = await supabaseAdmin
        .from('people')
        .select('id, tmdb_person_id')
        .in('tmdb_person_id', tmdbPersonIds.length > 0 ? tmdbPersonIds : [-1]);

      const peopleMap = new Map((dbPeople || []).map((p: any) => [p.tmdb_person_id, p.id]));

      const results = tmdbData.results.map((person) => ({
        tmdbPersonId: person.id,
        personId: peopleMap.get(person.id) ?? null,
        name: person.name,
        knownForDepartment: person.known_for_department || 'Acting',
        profilePath: person.profile_path ?? null,
        knownForTitles: (person.known_for || []).map((kf) => kf.title || kf.name || '').filter(Boolean),
      }));

      const responsePayload = {
        page: tmdbData.page,
        totalPages: tmdbData.total_pages,
        results,
      };

      await supabaseAdmin.from('tmdb_search_cache').upsert({
        query_key: queryKey,
        payload: responsePayload,
        fetched_at: new Date().toISOString(),
      });

      return jsonResponse(responsePayload);
    }

    // 3. movie_details
    if (payload.action === 'movie_details') {
      let region = payload.region;
      if (!region) {
        const { data: userProfile } = await supabaseAdmin
          .from('profiles')
          .select('region')
          .eq('user_id', auth.userId)
          .single();
        region = userProfile?.region || 'IN';
      }

      // Check tmdb_cache
      const { data: cached } = await supabaseAdmin
        .from('tmdb_cache')
        .select('*')
        .eq('tmdb_id', payload.tmdbId)
        .single();

      const detailsValid =
        cached?.details &&
        Date.now() - new Date(cached.details_fetched_at).getTime() < 7 * 86400 * 1000;
      const providersValid =
        cached?.providers &&
        cached.providers_fetched_at &&
        Date.now() - new Date(cached.providers_fetched_at).getTime() < 24 * 3600 * 1000;

      let rawDetails: TmdbMovieDetailsResult;
      let rawProviders: Record<string, unknown> | null = null;

      if (detailsValid) {
        rawDetails = cached.details as unknown as TmdbMovieDetailsResult;
        rawProviders = (cached.providers as Record<string, unknown>) || null;
      } else {
        rawDetails = await fetchTmdb<TmdbMovieDetailsResult>(
          `/movie/${payload.tmdbId}?append_to_response=credits,videos,release_dates,watch/providers&language=en-US`
        );
        rawProviders = rawDetails['watch/providers']?.results || null;

        await supabaseAdmin.from('tmdb_cache').upsert({
          tmdb_id: payload.tmdbId,
          details: rawDetails as unknown as Record<string, unknown>,
          details_fetched_at: new Date().toISOString(),
          providers: rawProviders,
          providers_fetched_at: new Date().toISOString(),
        });
      }

      // If details was valid but providers expired, refresh providers separately
      if (detailsValid && !providersValid) {
        try {
          const freshProviders = await fetchTmdb<{ results?: Record<string, unknown> }>(
            `/movie/${payload.tmdbId}/watch/providers`
          );
          rawProviders = freshProviders.results || null;
          await supabaseAdmin
            .from('tmdb_cache')
            .update({
              providers: rawProviders,
              providers_fetched_at: new Date().toISOString(),
            })
            .eq('tmdb_id', payload.tmdbId);
        } catch {
          // Non-fatal fallback to existing providers
        }
      }

      // Cross-reference DB movies
      const { data: dbMovie } = await supabaseAdmin
        .from('movies')
        .select('id, has_story, runtime_min, genres')
        .eq('tmdb_id', payload.tmdbId)
        .single();

      const year = rawDetails.release_date
        ? parseInt(rawDetails.release_date.slice(0, 4), 10)
        : null;

      // Extract certification
      let certification: string | null = null;
      const releaseResults = rawDetails.release_dates?.results || [];
      const matchRegion =
        releaseResults.find((r) => r.iso_3166_1 === region) ||
        releaseResults.find((r) => r.iso_3166_1 === 'US') ||
        releaseResults[0];
      if (matchRegion?.release_dates) {
        const withCert = matchRegion.release_dates.find((d) => d.certification?.trim());
        certification = withCert?.certification?.trim() || null;
      }

      // Directors & cast
      const directors = (rawDetails.credits?.crew || [])
        .filter((c) => c.job === 'Director')
        .map((d) => ({
          tmdbPersonId: d.id,
          name: d.name,
          profilePath: d.profile_path ?? null,
        }));

      const cast = (rawDetails.credits?.cast || []).slice(0, 15).map((c) => ({
        tmdbPersonId: c.id,
        name: c.name,
        character: c.character || '',
        profilePath: c.profile_path ?? null,
      }));

      // Trailer
      const trailer = (rawDetails.videos?.results || []).find(
        (v) => v.site === 'YouTube' && v.type === 'Trailer'
      );

      // Providers for requested region
      let regionProviders: unknown = null;
      const targetRegion = region || 'IN';
      const regionData = (rawProviders as Record<string, any>)?.[targetRegion];
      if (regionData) {
        regionProviders = {
          region,
          justWatchLink: regionData.link || null,
          flatrate: (regionData.flatrate || []).map((p: any) => ({
            providerId: p.provider_id,
            providerName: p.provider_name,
            logoPath: p.logo_path,
          })),
          free: [...(regionData.free || []), ...(regionData.ads || [])].map((p: any) => ({
            providerId: p.provider_id,
            providerName: p.provider_name,
            logoPath: p.logo_path,
          })),
          rent: (regionData.rent || []).map((p: any) => ({
            providerId: p.provider_id,
            providerName: p.provider_name,
            logoPath: p.logo_path,
          })),
          buy: (regionData.buy || []).map((p: any) => ({
            providerId: p.provider_id,
            providerName: p.provider_name,
            logoPath: p.logo_path,
          })),
          attribution: 'JustWatch' as const,
        };
      }

      const response = {
        movieId: dbMovie?.id ?? null,
        tmdbId: rawDetails.id,
        title: rawDetails.title,
        originalTitle: rawDetails.original_title || null,
        year: Number.isNaN(year) ? null : year,
        posterPath: rawDetails.poster_path ?? null,
        backdropPath: rawDetails.backdrop_path ?? null,
        genres: dbMovie?.genres?.length
          ? dbMovie.genres
          : (rawDetails.genres || []).map((g) => g.name),
        runtimeMin: dbMovie?.runtime_min ?? rawDetails.runtime ?? null,
        hasStory: dbMovie?.has_story ?? false,
        tagline: rawDetails.tagline || null,
        overview: rawDetails.overview || null,
        certification,
        directors,
        cast,
        trailerYoutubeKey: trailer?.key || null,
        providers: regionProviders,
      };

      return jsonResponse(response);
    }

    // 4. person_details
    if (payload.action === 'person_details') {
      const { data: cached } = await supabaseAdmin
        .from('tmdb_person_cache')
        .select('*')
        .eq('tmdb_person_id', payload.tmdbPersonId)
        .single();

      let details: any;
      if (
        cached &&
        Date.now() - new Date(cached.fetched_at).getTime() < 7 * 86400 * 1000
      ) {
        details = cached.details;
      } else {
        details = await fetchTmdb<any>(
          `/person/${payload.tmdbPersonId}?append_to_response=movie_credits`
        );
        await supabaseAdmin.from('tmdb_person_cache').upsert({
          tmdb_person_id: payload.tmdbPersonId,
          details,
          fetched_at: new Date().toISOString(),
        });
      }

      const { data: dbPerson } = await supabaseAdmin
        .from('people')
        .select('id')
        .eq('tmdb_person_id', payload.tmdbPersonId)
        .single();

      // Collect movie tmdb IDs from directed and acted
      const crewList: any[] = details.movie_credits?.crew || [];
      const castList: any[] = details.movie_credits?.cast || [];

      const directedTmdb = crewList
        .filter((c) => c.job === 'Director')
        .map((c) => c.id);
      const actedTmdb = castList.map((c) => c.id);
      const allTmdbIds = Array.from(new Set([...directedTmdb, ...actedTmdb]));

      const { data: dbMovies } = await supabaseAdmin
        .from('movies')
        .select('id, tmdb_id, has_story, runtime_min, genres')
        .in('tmdb_id', allTmdbIds.length > 0 ? allTmdbIds : [-1]);

      const movieMap = new Map<number, any>((dbMovies || []).map((m: any) => [m.tmdb_id, m]));

      const formatSummary = (item: any) => {
        const m = movieMap.get(item.id);
        const year = item.release_date ? parseInt(item.release_date.slice(0, 4), 10) : null;
        return {
          movieId: m?.id ?? null,
          tmdbId: item.id,
          title: item.title,
          year: Number.isNaN(year) ? null : year,
          posterPath: item.poster_path ?? null,
          backdropPath: item.backdrop_path ?? null,
          genres: m?.genres ?? [],
          runtimeMin: m?.runtime_min ?? null,
          hasStory: m?.has_story ?? false,
        };
      };

      const directed = crewList.filter((c) => c.job === 'Director').map(formatSummary);
      const acted = castList.map(formatSummary);

      return jsonResponse({
        tmdbPersonId: details.id,
        personId: dbPerson?.id ?? null,
        name: details.name,
        biography: details.biography || null,
        profilePath: details.profile_path ?? null,
        knownForDepartment: details.known_for_department || 'Acting',
        directed,
        acted,
      });
    }

    // 5. provider_catalog
    if (payload.action === 'provider_catalog') {
      const data = await fetchTmdb<{ results?: Array<{ provider_id: number; provider_name: string; logo_path: string; display_priority: number }> }>(
        `/watch/providers/movie?watch_region=${payload.region}`
      );

      const providers = (data.results || [])
        .sort((a, b) => a.display_priority - b.display_priority)
        .slice(0, 40)
        .map((p) => ({
          providerId: p.provider_id,
          providerName: p.provider_name,
          logoPath: p.logo_path,
        }));

      return jsonResponse({
        region: payload.region,
        providers,
      });
    }

    // 6. onboarding_picks
    if (payload.action === 'onboarding_picks') {
      // 60 high-sitelink movies sampled from movies catalog with has_story = true
      const { data: movies } = await supabaseAdmin
        .from('movies')
        .select('id, tmdb_id, title, year, genres, runtime_min, has_story')
        .eq('has_story', true)
        .not('tmdb_id', 'is', null)
        .order('sitelinks', { ascending: false, nullsFirst: false })
        .limit(60);

      const movieItems: any[] = movies || [];
      const tmdbIds = movieItems.map((m: any) => m.tmdb_id as number);

      // Hydrate posters from tmdb_cache
      const { data: cachedPosters } = await supabaseAdmin
        .from('tmdb_cache')
        .select('tmdb_id, details')
        .in('tmdb_id', tmdbIds.length > 0 ? tmdbIds : [-1]);

      const posterMap = new Map(
        (cachedPosters || []).map((c: any) => [
          c.tmdb_id,
          (c.details as Record<string, any>)?.poster_path ?? null,
        ])
      );

      const resultMovies = movieItems.map((m: any) => ({
        movieId: m.id,
        tmdbId: m.tmdb_id as number,
        title: m.title || '',
        year: m.year,
        posterPath: posterMap.get(m.tmdb_id as number) ?? null,
        backdropPath: null,
        genres: m.genres,
        runtimeMin: m.runtime_min,
        hasStory: m.has_story,
      }));

      return jsonResponse({ movies: resultMovies });
    }

    return errorResponse('BAD_REQUEST', 'Unknown action');
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return errorResponse(err.code, err.message, err.code === 'UNAUTHORIZED' ? 401 : 403);
    }
    if (err instanceof TmdbError) {
      return errorResponse(err.code, err.message, err.status);
    }
    console.error('tmdb-proxy unhandled error:', err);
    return errorResponse('UPSTREAM_ERROR', err instanceof Error ? err.message : 'Internal error', 500);
  }
});
