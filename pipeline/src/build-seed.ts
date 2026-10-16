import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_CATALOG_FILMS, type SeedFilmDefinition } from './catalog-data';
import { embedPlotStory, formatHalfvecLiteral } from './embed';
import { computePopularityPercentiles } from './imdb';
import { embedCanonicalMoods, type EmbeddedMoodRow } from './moods';
import {
  buildStoryHeader,
  cleanPlotText,
  computePlotHash,
  countWords,
  isValidPlot,
} from './plot-clean';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
export const SEED_SQL_PATH = resolve(CURRENT_DIR, '..', '..', 'supabase', 'seed.sql');
export const SEED_EMBEDDED_FIXTURE_PATH = resolve(
  CURRENT_DIR,
  '..',
  'fixtures',
  'seed-catalog-embedded.json',
);

export interface EmbeddedSeedMovie {
  readonly id: number;
  readonly wikidataQid: string;
  readonly tmdbId: number;
  readonly imdbId: string;
  readonly title: string;
  readonly year: number;
  readonly runtimeMin: number;
  readonly genres: readonly string[];
  readonly subjects: readonly string[];
  readonly settings: readonly string[];
  readonly languages: readonly string[];
  readonly countries: readonly string[];
  readonly seriesQid: string | null;
  readonly sitelinks: number;
  readonly imdbRating: number;
  readonly imdbVotes: number;
  readonly popularityPct: number;
  readonly hasStory: boolean;
  readonly plotHash: string;
  readonly enwikiTitle: string;
  readonly chunks: number;
  readonly embedding: readonly number[];
  readonly directorIds: readonly number[];
  readonly castIds: readonly number[];
}

export interface EmbeddedSeedPerson {
  readonly id: number;
  readonly wikidataQid: string;
  readonly tmdbPersonId: number;
  readonly name: string;
}

export interface EmbeddedSeedCatalogFixture {
  readonly generatedAt: string;
  readonly model: string;
  readonly movies: readonly EmbeddedSeedMovie[];
  readonly people: readonly EmbeddedSeedPerson[];
  readonly moods: readonly EmbeddedMoodRow[];
}

function sqlString(val: string | null | undefined): string {
  if (val === null || val === undefined) {
    return 'NULL';
  }
  return `'${val.replace(/'/g, "''")}'`;
}

function sqlTextArray(arr: readonly string[]): string {
  if (arr.length === 0) {
    return "'{}'::text[]";
  }
  const escaped = arr.map((item) => `'${item.replace(/'/g, "''")}'`).join(', ');
  return `ARRAY[${escaped}]::text[]`;
}

/**
 * Generates `supabase/seed.sql` and `pipeline/fixtures/seed-catalog-embedded.json`
 * from `SEED_CATALOG_FILMS` (~256 diverse films) using real `Supabase/gte-small` embeddings.
 */
export async function buildSeedCatalog(): Promise<EmbeddedSeedCatalogFixture> {
  console.log(`[build-seed] Validating ${SEED_CATALOG_FILMS.length} seed films...`);

  const seenQids = new Set<string>();
  const seenTmdbIds = new Set<number>();
  const seenImdbIds = new Set<string>();

  for (const film of SEED_CATALOG_FILMS) {
    if (seenQids.has(film.wikidataQid)) {
      throw new Error(`Duplicate wikidataQid in seed catalog: ${film.wikidataQid} (${film.title})`);
    }
    if (seenTmdbIds.has(film.tmdbId)) {
      throw new Error(`Duplicate tmdbId in seed catalog: ${film.tmdbId} (${film.title})`);
    }
    if (seenImdbIds.has(film.imdbId)) {
      throw new Error(`Duplicate imdbId in seed catalog: ${film.imdbId} (${film.title})`);
    }
    seenQids.add(film.wikidataQid);
    seenTmdbIds.add(film.tmdbId);
    seenImdbIds.add(film.imdbId);

    const cleaned = cleanPlotText(film.plot);
    if (!isValidPlot(cleaned)) {
      throw new Error(
        `Seed film "${film.title}" plot has only ${countWords(cleaned)} words (< 60 minimum).`,
      );
    }
  }

  console.log('[build-seed] Computing popularity percentiles...');
  const popularityMap = computePopularityPercentiles(
    SEED_CATALOG_FILMS.map((f) => ({
      id: f.wikidataQid,
      imdbVotes: f.imdbVotes,
      sitelinks: f.sitelinks,
    })),
  );

  console.log('[build-seed] Embedding 8 canonical moods with Supabase/gte-small...');
  const embeddedMoods = await embedCanonicalMoods();

  // Assign deterministic IDs for people
  const personQidToPerson = new Map<string, EmbeddedSeedPerson>();
  let nextPersonId = 1;
  for (const film of SEED_CATALOG_FILMS) {
    for (const credit of film.credits) {
      if (!personQidToPerson.has(credit.wikidataQid)) {
        personQidToPerson.set(credit.wikidataQid, {
          id: nextPersonId,
          wikidataQid: credit.wikidataQid,
          tmdbPersonId: credit.tmdbPersonId,
          name: credit.name,
        });
        nextPersonId += 1;
      }
    }
  }

  console.log(
    `[build-seed] Embedding ${SEED_CATALOG_FILMS.length} film plots with Supabase/gte-small...`,
  );
  const embeddedMovies: EmbeddedSeedMovie[] = [];

  for (let i = 0; i < SEED_CATALOG_FILMS.length; i += 1) {
    const film: SeedFilmDefinition | undefined = SEED_CATALOG_FILMS[i];
    if (!film) {
      continue;
    }
    const movieId = i + 1;
    const cleanedPlot = cleanPlotText(film.plot);
    const headerInput = {
      genres: film.genres,
      subjects: film.subjects,
      settings: film.settings,
    };
    const header = buildStoryHeader(headerInput);
    const plotHash = computePlotHash(header, cleanedPlot);
    const embResult = await embedPlotStory({
      headerInput,
      cleanedPlot,
    });

    const directorIds: number[] = [];
    const castIds: number[] = [];
    for (const credit of film.credits) {
      const person = personQidToPerson.get(credit.wikidataQid);
      if (!person) {
        continue;
      }
      if (credit.role === 'director') {
        directorIds.push(person.id);
      } else if (credit.role === 'cast') {
        castIds.push(person.id);
      }
    }

    embeddedMovies.push({
      id: movieId,
      wikidataQid: film.wikidataQid,
      tmdbId: film.tmdbId,
      imdbId: film.imdbId,
      title: film.title,
      year: film.year,
      runtimeMin: film.runtimeMin,
      genres: film.genres,
      subjects: film.subjects,
      settings: film.settings,
      languages: film.languages,
      countries: film.countries,
      seriesQid: film.seriesQid ?? null,
      sitelinks: film.sitelinks,
      imdbRating: film.imdbRating,
      imdbVotes: film.imdbVotes,
      popularityPct: popularityMap.get(film.wikidataQid) ?? 0.5,
      hasStory: true,
      plotHash,
      enwikiTitle: film.enwikiTitle,
      chunks: embResult.chunks,
      embedding: embResult.embedding.map((v) => Number(v.toFixed(6))),
      directorIds,
      castIds,
    });

    if ((i + 1) % 50 === 0 || i + 1 === SEED_CATALOG_FILMS.length) {
      console.log(`[build-seed] Embedded ${i + 1}/${SEED_CATALOG_FILMS.length} films...`);
    }
  }

  const peopleList = Array.from(personQidToPerson.values());

  // Build supabase/seed.sql
  const sqlLines: string[] = [
    '-- supabase/seed.sql',
    '-- Generated by `bun --filter @tonight/pipeline build-seed`',
    `-- Contains ${embeddedMovies.length} diverse films with real Supabase/gte-small (384-dim halfvec) embeddings`,
    '-- Strictly adheres to the ML/Display wall (Wikidata + Wikipedia + IMDb only; zero TMDB text).',
    '',
    'begin;',
    '',
    '-- 1. Canonical Moods (8 rows)',
  ];

  for (const mood of embeddedMoods) {
    const vecLit = formatHalfvecLiteral(mood.embedding);
    sqlLines.push(
      `insert into public.moods (id, label, description, embedding, sort) values (${sqlString(
        mood.id,
      )}, ${sqlString(mood.label)}, ${sqlString(mood.description)}, '${vecLit}'::extensions.halfvec(384), ${
        mood.sort
      }) on conflict (id) do update set label = excluded.label, description = excluded.description, embedding = excluded.embedding, sort = excluded.sort;`,
    );
  }

  sqlLines.push('', `-- 2. Catalog Movies (${embeddedMovies.length} rows)`);
  for (const m of embeddedMovies) {
    sqlLines.push(
      `insert into public.movies (id, wikidata_qid, tmdb_id, imdb_id, title, original_title, year, runtime_min, genres, subjects, settings, languages, countries, series_qid, sitelinks, imdb_rating, imdb_votes, popularity_pct, has_story, source, plot_hash, enwiki_title) overriding system value values (${
        m.id
      }, ${sqlString(m.wikidataQid)}, ${m.tmdbId}, ${sqlString(m.imdbId)}, ${sqlString(
        m.title,
      )}, ${sqlString(m.title)}, ${m.year}, ${m.runtimeMin}, ${sqlTextArray(
        m.genres,
      )}, ${sqlTextArray(m.subjects)}, ${sqlTextArray(m.settings)}, ${sqlTextArray(
        m.languages,
      )}, ${sqlTextArray(m.countries)}, ${sqlString(m.seriesQid)}, ${m.sitelinks}, ${
        m.imdbRating
      }, ${m.imdbVotes}, ${m.popularityPct}, true, 'wikidata', ${sqlString(
        m.plotHash,
      )}, ${sqlString(
        m.enwikiTitle,
      )}) on conflict (id) do update set wikidata_qid = excluded.wikidata_qid, tmdb_id = excluded.tmdb_id, imdb_id = excluded.imdb_id, title = excluded.title, year = excluded.year, runtime_min = excluded.runtime_min, genres = excluded.genres, subjects = excluded.subjects, settings = excluded.settings, languages = excluded.languages, countries = excluded.countries, series_qid = excluded.series_qid, sitelinks = excluded.sitelinks, imdb_rating = excluded.imdb_rating, imdb_votes = excluded.imdb_votes, popularity_pct = excluded.popularity_pct, has_story = excluded.has_story, plot_hash = excluded.plot_hash, enwiki_title = excluded.enwiki_title;`,
    );
  }

  sqlLines.push(
    "select setval(pg_get_serial_sequence('public.movies', 'id'), (select coalesce(max(id), 1) from public.movies));",
  );

  sqlLines.push('', `-- 3. Movie Embeddings (${embeddedMovies.length} rows)`);
  for (const m of embeddedMovies) {
    const vecLit = formatHalfvecLiteral(m.embedding);
    sqlLines.push(
      `insert into public.movie_embeddings (movie_id, embedding, model, chunks) values (${m.id}, '${vecLit}'::extensions.halfvec(384), 'gte-small', ${m.chunks}) on conflict (movie_id) do update set embedding = excluded.embedding, model = excluded.model, chunks = excluded.chunks;`,
    );
  }

  sqlLines.push('', `-- 4. People (${peopleList.length} rows)`);
  for (const p of peopleList) {
    sqlLines.push(
      `insert into public.people (id, wikidata_qid, tmdb_person_id, name) overriding system value values (${
        p.id
      }, ${sqlString(p.wikidataQid)}, ${p.tmdbPersonId}, ${sqlString(
        p.name,
      )}) on conflict (id) do update set wikidata_qid = excluded.wikidata_qid, tmdb_person_id = excluded.tmdb_person_id, name = excluded.name;`,
    );
  }
  sqlLines.push(
    "select setval(pg_get_serial_sequence('public.people', 'id'), (select coalesce(max(id), 1) from public.people));",
  );

  sqlLines.push('', '-- 5. Movie People Credits');
  for (let i = 0; i < SEED_CATALOG_FILMS.length; i += 1) {
    const film = SEED_CATALOG_FILMS[i];
    if (!film) {
      continue;
    }
    const movieId = i + 1;
    for (const credit of film.credits) {
      const person = personQidToPerson.get(credit.wikidataQid);
      if (!person) {
        continue;
      }
      const billingLit = credit.billing !== undefined ? String(credit.billing) : 'NULL';
      sqlLines.push(
        `insert into public.movie_people (movie_id, person_id, role, billing) values (${movieId}, ${
          person.id
        }, ${sqlString(
          credit.role,
        )}, ${billingLit}) on conflict (movie_id, person_id, role) do update set billing = excluded.billing;`,
      );
    }
  }

  sqlLines.push(
    '',
    '-- 6. Pipeline State',
    `insert into public.pipeline_state (key, value) values ('seed_catalog', '{"films": ${embeddedMovies.length}, "model": "gte-small"}'::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now();`,
    '',
    'commit;',
    '',
  );

  await mkdir(dirname(SEED_SQL_PATH), { recursive: true });
  await writeFile(SEED_SQL_PATH, sqlLines.join('\n'), 'utf8');
  console.log(`[build-seed] Wrote ${SEED_SQL_PATH} (${embeddedMovies.length} films).`);

  const fixture: EmbeddedSeedCatalogFixture = {
    generatedAt: new Date().toISOString(),
    model: 'gte-small',
    movies: embeddedMovies,
    people: peopleList,
    moods: embeddedMoods,
  };

  await mkdir(dirname(SEED_EMBEDDED_FIXTURE_PATH), { recursive: true });
  await writeFile(SEED_EMBEDDED_FIXTURE_PATH, JSON.stringify(fixture, null, 2), 'utf8');
  console.log(`[build-seed] Wrote ${SEED_EMBEDDED_FIXTURE_PATH}.`);

  return fixture;
}

if (import.meta.main) {
  buildSeedCatalog().catch((err: unknown) => {
    console.error('[build-seed] Fatal error:', err);
    process.exit(1);
  });
}
