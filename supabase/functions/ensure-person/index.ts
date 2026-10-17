// supabase/functions/ensure-person/index.ts
import { ensurePersonRequestSchema } from '@tonight/shared';
import { authenticateRequest, AuthError } from '../_shared/auth.ts';
import { corsHeaders, errorResponse, handleCors, jsonResponse } from '../_shared/cors.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

const WIKI_USER_AGENT = 'TonightBot/0.1 (https://github.com/aarabii/Tonight)';

async function lookupWikidataPersonByTmdbId(tmdbPersonId: number): Promise<{
  qid: string;
  name: string;
} | null> {
  const sparql = `SELECT ?person ?personLabel WHERE {
  ?person wdt:P4985 "${tmdbPersonId}".
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
      results?: { bindings?: Array<{ person?: { value: string }; personLabel?: { value: string } }> };
    };

    const first = data.results?.bindings?.[0];
    if (!first?.person?.value) return null;

    const qid = first.person.value.split('/').pop() || '';
    const name = first.personLabel?.value || '';
    if (!qid || !name || name.startsWith('Q')) return null;

    return { qid, name };
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
    const parseResult = ensurePersonRequestSchema.safeParse(body);

    if (!parseResult.success) {
      return errorResponse('BAD_REQUEST', parseResult.error.message, 400);
    }

    const { tmdbPersonId, fallbackName } = parseResult.data;

    // 1. Check if person already exists in DB
    const { data: existing } = await supabaseAdmin
      .from('people')
      .select('id')
      .eq('tmdb_person_id', tmdbPersonId)
      .maybeSingle();

    if (existing) {
      return jsonResponse({ personId: existing.id });
    }

    // 2. Query Wikidata SPARQL for P4985
    const wikidata = await lookupWikidataPersonByTmdbId(tmdbPersonId);

    if (wikidata) {
      const { data: inserted, error } = await supabaseAdmin
        .from('people')
        .insert({
          wikidata_qid: wikidata.qid,
          tmdb_person_id: tmdbPersonId,
          name: wikidata.name,
        })
        .select('id')
        .single();

      if (!error && inserted) {
        return jsonResponse({ personId: inserted.id });
      }
    }

    // 3. Fallback: Minimal row with fallbackName (wikidata_qid is null)
    const { data: stub, error: stubError } = await supabaseAdmin
      .from('people')
      .insert({
        tmdb_person_id: tmdbPersonId,
        name: fallbackName,
      })
      .select('id')
      .single();

    if (stubError || !stub) {
      // Check if inserted concurrently
      const { data: recheck } = await supabaseAdmin
        .from('people')
        .select('id')
        .eq('tmdb_person_id', tmdbPersonId)
        .single();

      if (recheck) {
        return jsonResponse({ personId: recheck.id });
      }

      throw new Error(stubError?.message || 'Failed to create person record');
    }

    return jsonResponse({ personId: stub.id });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return errorResponse(err.code, err.message, 401);
    }
    console.error('ensure-person unhandled error:', err);
    return errorResponse('UPSTREAM_ERROR', err instanceof Error ? err.message : 'Internal error', 500);
  }
});
