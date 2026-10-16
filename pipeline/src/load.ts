import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import postgres, { type Sql } from 'postgres';
import { formatHalfvecLiteral } from './embed';
import type { EmbeddedMoodRow } from './moods';
import type { WikidataPersonCredit } from './wikidata';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CACHE_DIR = resolve(CURRENT_DIR, '..', '.cache');

export interface CatalogMovieUpsertRow {
  readonly wikidataQid: string;
  readonly tmdbId: number | null;
  readonly imdbId: string | null;
  readonly title: string;
  readonly originalTitle: string | null;
  readonly year: number | null;
  readonly runtimeMin: number | null;
  readonly genres: readonly string[];
  readonly subjects: readonly string[];
  readonly settings: readonly string[];
  readonly languages: readonly string[];
  readonly countries: readonly string[];
  readonly seriesQid: string | null;
  readonly sitelinks: number | null;
  readonly imdbRating: number | null;
  readonly imdbVotes: number | null;
  readonly popularityPct: number | null;
  readonly hasStory: boolean;
  readonly plotHash: string | null;
  readonly enwikiTitle: string | null;
}

export interface CatalogEmbeddingUpsertRow {
  readonly movieId: number;
  readonly embedding: readonly number[];
  readonly model: string;
  readonly chunks: number;
}

export interface PipelineDbConnection {
  readonly sql: Sql | null;
  readonly supabase: SupabaseClient | null;
  readonly close: () => Promise<void>;
}

export function hasValidDatabaseUrl(url: string | undefined): url is string {
  return Boolean(url && url.trim().length > 0 && !url.includes('<DB_PASSWORD>'));
}

/**
 * Creates a pipeline database connection using either `DATABASE_URL` (`postgres` TCP client)
 * or `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (`@supabase/supabase-js` service role client).
 */
export function createPipelineDbConnection(env: NodeJS.ProcessEnv = process.env): PipelineDbConnection {
  const databaseUrl = env.DATABASE_URL;
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  const sql = hasValidDatabaseUrl(databaseUrl)
    ? postgres(databaseUrl, {
        max: 4,
        idle_timeout: 20,
        connect_timeout: 15,
      })
    : null;

  const supabase =
    supabaseUrl && serviceRoleKey
      ? createClient(supabaseUrl, serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;

  if (!sql && !supabase) {
    throw new Error(
      'Missing database credentials: set DATABASE_URL or (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).',
    );
  }

  return {
    sql,
    supabase,
    close: async () => {
      if (sql) {
        await sql.end({ timeout: 5 });
      }
    },
  };
}

/**
 * Reads a JSON checkpoint file from `pipeline/.cache/{name}.json` if it exists.
 */
export async function readCheckpoint<T>(
  name: string,
  cacheDir: string = DEFAULT_CACHE_DIR,
): Promise<T | null> {
  try {
    const filePath = resolve(cacheDir, `${name}.json`);
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Writes a JSON checkpoint file to `pipeline/.cache/{name}.json`.
 */
export async function writeCheckpoint<T>(
  name: string,
  data: T,
  cacheDir: string = DEFAULT_CACHE_DIR,
): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  const filePath = resolve(cacheDir, `${name}.json`);
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Upserts the 8 canonical moods into `public.moods`.
 */
export async function upsertMoods(
  conn: PipelineDbConnection,
  moods: readonly EmbeddedMoodRow[],
): Promise<void> {
  if (moods.length === 0) {
    return;
  }

  const rows = moods.map((m) => ({
    id: m.id,
    label: m.label,
    description: m.description,
    embedding: formatHalfvecLiteral(m.embedding),
    sort: m.sort,
  }));

  if (conn.sql) {
    for (const row of rows) {
      await conn.sql`
        insert into public.moods (id, label, description, embedding, sort)
        values (${row.id}, ${row.label}, ${row.description}, ${row.embedding}::extensions.halfvec(384), ${row.sort})
        on conflict (id) do update set
          label = excluded.label,
          description = excluded.description,
          embedding = excluded.embedding,
          sort = excluded.sort
      `;
    }
    return;
  }

  if (conn.supabase) {
    const { error } = await conn.supabase.from('moods').upsert(rows, { onConflict: 'id' });
    if (error) {
      throw new Error(`Failed to upsert moods: ${error.message}`);
    }
  }
}

/**
 * Batch-upserts catalog movies and returns a map of `wikidataQid -> movies.id` and existing `plot_hash`.
 */
export async function upsertMoviesBatch(
  conn: PipelineDbConnection,
  movies: readonly CatalogMovieUpsertRow[],
  batchSize: number = 250,
): Promise<Map<string, { id: number; plotHash: string | null }>> {
  const result = new Map<string, { id: number; plotHash: string | null }>();
  if (movies.length === 0) {
    return result;
  }

  for (let offset = 0; offset < movies.length; offset += batchSize) {
    const slice = movies.slice(offset, offset + batchSize);
    const payload = slice.map((m) => ({
      wikidata_qid: m.wikidataQid,
      tmdb_id: m.tmdbId,
      imdb_id: m.imdbId,
      title: m.title,
      original_title: m.originalTitle,
      year: m.year,
      runtime_min: m.runtimeMin,
      genres: [...m.genres],
      subjects: [...m.subjects],
      settings: [...m.settings],
      languages: [...m.languages],
      countries: [...m.countries],
      series_qid: m.seriesQid,
      sitelinks: m.sitelinks,
      imdb_rating: m.imdbRating,
      imdb_votes: m.imdbVotes,
      popularity_pct: m.popularityPct,
      has_story: m.hasStory,
      source: 'wikidata',
      plot_hash: m.plotHash,
      enwiki_title: m.enwikiTitle,
      updated_at: new Date().toISOString(),
    }));

    if (conn.supabase) {
      const { data, error } = await conn.supabase
        .from('movies')
        .upsert(payload, { onConflict: 'wikidata_qid' })
        .select('id, wikidata_qid, plot_hash');
      if (error) {
        throw new Error(`Failed to upsert movies batch: ${error.message}`);
      }
      for (const row of (data ?? []) as Array<{
        id: number;
        wikidata_qid: string | null;
        plot_hash: string | null;
      }>) {
        if (row.wikidata_qid) {
          result.set(row.wikidata_qid, { id: Number(row.id), plotHash: row.plot_hash });
        }
      }
      continue;
    }

    if (conn.sql) {
      for (const row of payload) {
        const inserted = await conn.sql<
          Array<{ id: number; wikidata_qid: string; plot_hash: string | null }>
        >`
          insert into public.movies (
            wikidata_qid, tmdb_id, imdb_id, title, original_title, year, runtime_min,
            genres, subjects, settings, languages, countries, series_qid, sitelinks,
            imdb_rating, imdb_votes, popularity_pct, has_story, source, plot_hash, enwiki_title, updated_at
          ) values (
            ${row.wikidata_qid}, ${row.tmdb_id}, ${row.imdb_id}, ${row.title}, ${row.original_title},
            ${row.year}, ${row.runtime_min}, ${row.genres}, ${row.subjects}, ${row.settings},
            ${row.languages}, ${row.countries}, ${row.series_qid}, ${row.sitelinks},
            ${row.imdb_rating}, ${row.imdb_votes}, ${row.popularity_pct}, ${row.has_story},
            'wikidata', ${row.plot_hash}, ${row.enwiki_title}, now()
          )
          on conflict (wikidata_qid) do update set
            tmdb_id = coalesce(excluded.tmdb_id, public.movies.tmdb_id),
            imdb_id = coalesce(excluded.imdb_id, public.movies.imdb_id),
            title = excluded.title,
            original_title = excluded.original_title,
            year = excluded.year,
            runtime_min = excluded.runtime_min,
            genres = excluded.genres,
            subjects = excluded.subjects,
            settings = excluded.settings,
            languages = excluded.languages,
            countries = excluded.countries,
            series_qid = excluded.series_qid,
            sitelinks = excluded.sitelinks,
            imdb_rating = excluded.imdb_rating,
            imdb_votes = excluded.imdb_votes,
            popularity_pct = excluded.popularity_pct,
            has_story = excluded.has_story,
            plot_hash = coalesce(excluded.plot_hash, public.movies.plot_hash),
            enwiki_title = excluded.enwiki_title,
            updated_at = now()
          returning id, wikidata_qid, plot_hash
        `;
        const first = inserted[0];
        if (first?.wikidata_qid) {
          result.set(first.wikidata_qid, { id: Number(first.id), plotHash: first.plot_hash });
        }
      }
    }
  }

  return result;
}

/**
 * Batch-upserts movie embeddings into `public.movie_embeddings` and marks `movies.has_story = true`.
 */
export async function upsertEmbeddingsBatch(
  conn: PipelineDbConnection,
  embeddings: readonly CatalogEmbeddingUpsertRow[],
  batchSize: number = 100,
): Promise<void> {
  if (embeddings.length === 0) {
    return;
  }

  for (let offset = 0; offset < embeddings.length; offset += batchSize) {
    const slice = embeddings.slice(offset, offset + batchSize);
    const payload = slice.map((item) => ({
      movie_id: item.movieId,
      embedding: formatHalfvecLiteral(item.embedding),
      model: item.model,
      chunks: item.chunks,
      updated_at: new Date().toISOString(),
    }));

    if (conn.supabase) {
      const { error } = await conn.supabase
        .from('movie_embeddings')
        .upsert(payload, { onConflict: 'movie_id' });
      if (error) {
        throw new Error(`Failed to upsert movie_embeddings batch: ${error.message}`);
      }
      continue;
    }

    if (conn.sql) {
      for (const row of payload) {
        await conn.sql`
          insert into public.movie_embeddings (movie_id, embedding, model, chunks, updated_at)
          values (${row.movie_id}, ${row.embedding}::extensions.halfvec(384), ${row.model}, ${row.chunks}, now())
          on conflict (movie_id) do update set
            embedding = excluded.embedding,
            model = excluded.model,
            chunks = excluded.chunks,
            updated_at = now()
        `;
      }
    }
  }
}

/**
 * Batch-upserts `people` and `movie_people` rows from Wikidata credits.
 */
export async function upsertCreditsBatch(
  conn: PipelineDbConnection,
  movieQidToId: ReadonlyMap<string, number>,
  creditsByFilmQid: ReadonlyMap<string, readonly WikidataPersonCredit[]>,
): Promise<void> {
  const uniquePeople = new Map<string, { wikidata_qid: string; tmdb_person_id: number | null; name: string }>();

  for (const [filmQid, credits] of creditsByFilmQid.entries()) {
    if (!movieQidToId.has(filmQid)) {
      continue;
    }
    for (const credit of credits) {
      if (!uniquePeople.has(credit.wikidataQid)) {
        uniquePeople.set(credit.wikidataQid, {
          wikidata_qid: credit.wikidataQid,
          tmdb_person_id: credit.tmdbPersonId,
          name: credit.name,
        });
      }
    }
  }

  const peopleArray = Array.from(uniquePeople.values());
  if (peopleArray.length === 0) {
    return;
  }

  const personQidToId = new Map<string, number>();

  if (conn.supabase) {
    for (let i = 0; i < peopleArray.length; i += 250) {
      const slice = peopleArray.slice(i, i + 250);
      const { data, error } = await conn.supabase
        .from('people')
        .upsert(slice, { onConflict: 'wikidata_qid' })
        .select('id, wikidata_qid');
      if (error) {
        throw new Error(`Failed to upsert people: ${error.message}`);
      }
      for (const row of (data ?? []) as Array<{ id: number; wikidata_qid: string | null }>) {
        if (row.wikidata_qid) {
          personQidToId.set(row.wikidata_qid, Number(row.id));
        }
      }
    }
  } else if (conn.sql) {
    for (const person of peopleArray) {
      const rows = await conn.sql<Array<{ id: number; wikidata_qid: string }>>`
        insert into public.people (wikidata_qid, tmdb_person_id, name)
        values (${person.wikidata_qid}, ${person.tmdb_person_id}, ${person.name})
        on conflict (wikidata_qid) do update set
          tmdb_person_id = coalesce(excluded.tmdb_person_id, public.people.tmdb_person_id),
          name = excluded.name
        returning id, wikidata_qid
      `;
      if (rows[0]?.wikidata_qid) {
        personQidToId.set(rows[0].wikidata_qid, Number(rows[0].id));
      }
    }
  }

  const moviePeopleRows: Array<{
    movie_id: number;
    person_id: number;
    role: string;
    billing: number | null;
  }> = [];

  for (const [filmQid, credits] of creditsByFilmQid.entries()) {
    const movieId = movieQidToId.get(filmQid);
    if (!movieId) {
      continue;
    }
    for (const credit of credits) {
      const personId = personQidToId.get(credit.wikidataQid);
      if (!personId) {
        continue;
      }
      moviePeopleRows.push({
        movie_id: movieId,
        person_id: personId,
        role: credit.role,
        billing: credit.billing,
      });
    }
  }

  if (conn.supabase) {
    for (let i = 0; i < moviePeopleRows.length; i += 250) {
      const slice = moviePeopleRows.slice(i, i + 250);
      const { error } = await conn.supabase
        .from('movie_people')
        .upsert(slice, { onConflict: 'movie_id,person_id,role' });
      if (error) {
        throw new Error(`Failed to upsert movie_people: ${error.message}`);
      }
    }
  } else if (conn.sql) {
    for (const mp of moviePeopleRows) {
      await conn.sql`
        insert into public.movie_people (movie_id, person_id, role, billing)
        values (${mp.movie_id}, ${mp.person_id}, ${mp.role}, ${mp.billing})
        on conflict (movie_id, person_id, role) do update set
          billing = excluded.billing
      `;
    }
  }
}

/**
 * Reads a state value from `public.pipeline_state`.
 */
export async function getPipelineState<T = Record<string, unknown>>(
  conn: PipelineDbConnection,
  key: string,
): Promise<T | null> {
  if (conn.supabase) {
    const { data, error } = await conn.supabase
      .from('pipeline_state')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error || !data) {
      return null;
    }
    return (data as { value: T }).value;
  }

  if (conn.sql) {
    const rows = await conn.sql<Array<{ value: T }>>`
      select value from public.pipeline_state where key = ${key} limit 1
    `;
    return rows[0]?.value ?? null;
  }

  return null;
}

/**
 * Upserts a state value into `public.pipeline_state`.
 */
export async function setPipelineState(
  conn: PipelineDbConnection,
  key: string,
  value: Record<string, unknown>,
): Promise<void> {
  if (conn.supabase) {
    const { error } = await conn.supabase.from('pipeline_state').upsert(
      {
        key,
        value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' },
    );
    if (error) {
      throw new Error(`Failed to update pipeline_state (${key}): ${error.message}`);
    }
    return;
  }

  if (conn.sql) {
    await conn.sql`
      insert into public.pipeline_state (key, value, updated_at)
      values (${key}, ${conn.sql.json(value as unknown as postgres.JSONValue)}, now())
      on conflict (key) do update set
        value = excluded.value,
        updated_at = now()
    `;
  }
}
