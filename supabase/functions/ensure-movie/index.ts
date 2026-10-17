// supabase/functions/ensure-movie/index.ts
import { ensureMovieRequestSchema } from '@tonight/shared';
import { authenticateRequest, AuthError } from '../_shared/auth.ts';
import { corsHeaders, errorResponse, handleCors, jsonResponse } from '../_shared/cors.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

const WIKI_USER_AGENT = 'TonightBot/0.1 (https://github.com/aarabii/Tonight)';

interface WikidataFilmBinding {
  film?: { value: string };
  filmLabel?: { value: string };
  imdb?: { value: string };
  pubDate?: { value: string };
  duration?: { value: string };
}

async function lookupWikidataByTmdbId(tmdbId: number): Promise<{
  qid: string;
  title: string | null;
  imdbId: string | null;
  year: number | null;
  runtimeMin: number | null;
} | null> {
  const sparql = `SELECT ?film ?filmLabel ?imdb ?pubDate ?duration WHERE {
  ?film wdt:P4947 "${tmdbId}".
  OPTIONAL { ?film wdt:P345 ?imdb. }
  OPTIONAL { ?film wdt:P577 ?pubDate. }
  OPTIONAL { ?film wdt:P2047 ?duration. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 1`;

  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': WIKI_USER_AGENT,
        Accept: 'application/sparql-results+json',
      },
    });

    clearTimeout(timeoutId);
    if (!res.ok) return null;

    const data = (await res.json()) as {
      results?: { bindings?: WikidataFilmBinding[] };
    };

    const first = data.results?.bindings?.[0];
    if (!first?.film?.value) return null;

    const qid = first.film.value.split('/').pop() || '';
    if (!qid) return null;

    const label = first.filmLabel?.value;
    const title = label && !label.startsWith('Q') ? label : null;
    const imdbId = first.imdb?.value || null;

    let year: number | null = null;
    if (first.pubDate?.value) {
      const parsedYear = parseInt(first.pubDate.value.slice(0, 4), 10);
      if (!Number.isNaN(parsedYear)) year = parsedYear;
    }

    let runtimeMin: number | null = null;
    if (first.duration?.value) {
      const parsed = parseFloat(first.duration.value);
      if (!Number.isNaN(parsed)) runtimeMin = Math.round(parsed);
    }

    return { qid, title, imdbId, year, runtimeMin };
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return errorResponse('BAD_REQUEST', 'Method not allowed', 405);
  }

  try {
    await authenticateRequest(req);
    const body = await req.json().catch(() => ({}));
    const parseResult = ensureMovieRequestSchema.safeParse(body);

    if (!parseResult.success) {
      return errorResponse('BAD_REQUEST', parseResult.error.message, 400);
    }

    const { tmdbId } = parseResult.data;

    // 1. Check if movie already exists in DB
    const { data: existing } = await supabaseAdmin
      .from('movies')
      .select('id, has_story, source')
      .eq('tmdb_id', tmdbId)
      .maybeSingle();

    if (existing) {
      return jsonResponse({
        movieId: existing.id,
        hasStory: existing.has_story,
        source: existing.source,
      });
    }

    // 2. Query Wikidata SPARQL for P4947
    const wikidata = await lookupWikidataByTmdbId(tmdbId);

    if (wikidata) {
      const { data: inserted, error } = await supabaseAdmin
        .from('movies')
        .insert({
          wikidata_qid: wikidata.qid,
          tmdb_id: tmdbId,
          imdb_id: wikidata.imdbId,
          title: wikidata.title,
          year: wikidata.year,
          runtime_min: wikidata.runtimeMin,
          source: 'wikidata',
          has_story: false,
        })
        .select('id, has_story, source')
        .single();

      if (!error && inserted) {
        return jsonResponse({
          movieId: inserted.id,
          hasStory: inserted.has_story,
          source: inserted.source,
        });
      }
    }

    // 3. Fallback: Insert stub row. Strictly NO TMDB text copied into movies table.
    const { data: stub, error: stubError } = await supabaseAdmin
      .from('movies')
      .insert({
        tmdb_id: tmdbId,
        source: 'tmdb_stub',
        has_story: false,
      })
      .select('id, has_story, source')
      .single();

    if (stubError || !stub) {
      // If another concurrent request inserted it first:
      const { data: recheck } = await supabaseAdmin
        .from('movies')
        .select('id, has_story, source')
        .eq('tmdb_id', tmdbId)
        .single();

      if (recheck) {
        return jsonResponse({
          movieId: recheck.id,
          hasStory: recheck.has_story,
          source: recheck.source,
        });
      }

      throw new Error(stubError?.message || 'Failed to create stub movie');
    }

    return jsonResponse({
      movieId: stub.id,
      hasStory: stub.has_story,
      source: stub.source,
    });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return errorResponse(err.code, err.message, 401);
    }
    console.error('ensure-movie unhandled error:', err);
    return errorResponse('UPSTREAM_ERROR', err instanceof Error ? err.message : 'Internal error', 500);
  }
});
