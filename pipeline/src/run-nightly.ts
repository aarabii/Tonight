import { embedPlotStory } from './embed';
import { computeRawPopularity, streamImdbRatings } from './imdb';
import {
  createPipelineDbConnection,
  getPipelineState,
  setPipelineState,
  upsertCreditsBatch,
  upsertEmbeddingsBatch,
  upsertMoviesBatch,
  type CatalogEmbeddingUpsertRow,
  type CatalogMovieUpsertRow,
} from './load';
import {
  buildStoryHeader,
  cleanPlotText,
  computePlotHash,
  isValidPlot,
} from './plot-clean';
import {
  buildCreditsSparqlQuery,
  fetchDeltaWikidataFilms,
  parseSparqlCreditBindings,
  querySparql,
} from './wikidata';
import { fetchWikipediaPlotsBatch } from './wikipedia';

interface SyncState {
  readonly completedAt?: string;
}

/**
 * Incremental nightly pipeline job:
 * 1. Reads `last_wikidata_sync` from `public.pipeline_state` (defaults to 48 hours ago)
 * 2. Queries WDQS for film deltas modified since that timestamp
 * 3. Fetches Wikipedia plots & IMDb ratings for changed films
 * 4. Re-embeds ONLY films whose `plot_hash` changed (or are newly added)
 * 5. Updates `pipeline_state` (also keeping the Supabase free-tier project active)
 */
export async function runNightlyDelta(options: { limit?: number } = {}): Promise<void> {
  const conn = createPipelineDbConnection();

  try {
    const prevSync = await getPipelineState<SyncState>(conn, 'last_wikidata_sync');
    const defaultSince = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const sinceIso = prevSync?.completedAt ?? defaultSince;

    console.log(`[nightly] Fetching Wikidata film deltas modified since ${sinceIso}...`);
    const deltaFilms = await fetchDeltaWikidataFilms({
      sinceIso,
      limit: options.limit ?? 250,
    });
    console.log(`[nightly] Found ${deltaFilms.length} modified films.`);

    if (deltaFilms.length > 0) {
      const imdbIds = new Set(
        deltaFilms.map((f) => f.imdbId).filter((id): id is string => Boolean(id)),
      );
      const imdbRatings =
        imdbIds.size > 0 ? await streamImdbRatings({ filterImdbIds: imdbIds }) : new Map();

      const plotsMap = await fetchWikipediaPlotsBatch(deltaFilms.map((f) => f.enwikiTitle));

      const movieRows: CatalogMovieUpsertRow[] = [];
      const candidatePlots = new Map<
        string,
        {
          cleanedPlot: string;
          plotHash: string;
          headerInput: { genres: string[]; subjects: string[]; settings: string[] };
        }
      >();

      for (const film of deltaFilms) {
        const rawPlot = plotsMap.get(film.enwikiTitle) ?? null;
        const cleanedPlot = rawPlot ? cleanPlotText(rawPlot) : '';
        const hasValidStory = isValidPlot(cleanedPlot);
        const headerInput = {
          genres: film.genres,
          subjects: film.subjects,
          settings: film.settings,
        };
        const header = buildStoryHeader(headerInput);
        const plotHash = hasValidStory ? computePlotHash(header, cleanedPlot) : null;
        const imdbRecord = film.imdbId ? imdbRatings.get(film.imdbId) : undefined;
        const rawPop = computeRawPopularity(imdbRecord?.numVotes ?? null, film.sitelinks);
        // Logistic approximation onto [0, 1] for incremental rows until next full percentile sweep
        const popularityPct = Number(Math.min(1, Math.max(0, rawPop / 14.5)).toFixed(6));

        movieRows.push({
          wikidataQid: film.wikidataQid,
          tmdbId: film.tmdbId,
          imdbId: film.imdbId,
          title: film.title,
          originalTitle: film.originalTitle,
          year: film.year,
          runtimeMin: film.runtimeMin,
          genres: film.genres,
          subjects: film.subjects,
          settings: film.settings,
          languages: film.languages,
          countries: film.countries,
          seriesQid: film.seriesQid,
          sitelinks: film.sitelinks,
          imdbRating: imdbRecord?.averageRating ?? null,
          imdbVotes: imdbRecord?.numVotes ?? null,
          popularityPct,
          hasStory: hasValidStory,
          plotHash,
          enwikiTitle: film.enwikiTitle,
        });

        if (hasValidStory && plotHash) {
          candidatePlots.set(film.wikidataQid, { cleanedPlot, plotHash, headerInput });
        }
      }

      const upsertedMap = await upsertMoviesBatch(conn, movieRows);
      const embeddingsToUpsert: CatalogEmbeddingUpsertRow[] = [];

      for (const [qid, plotData] of candidatePlots.entries()) {
        const dbRow = upsertedMap.get(qid);
        if (!dbRow) {
          continue;
        }
        const embedded = await embedPlotStory({
          headerInput: plotData.headerInput,
          cleanedPlot: plotData.cleanedPlot,
        });
        embeddingsToUpsert.push({
          movieId: dbRow.id,
          embedding: embedded.embedding,
          model: embedded.model,
          chunks: embedded.chunks,
        });
      }

      await upsertEmbeddingsBatch(conn, embeddingsToUpsert);

      const batchQids = deltaFilms.map((f) => f.wikidataQid);
      const creditsResp = await querySparql(buildCreditsSparqlQuery(batchQids));
      const creditsByFilm = parseSparqlCreditBindings(creditsResp.results.bindings);
      const qidToMovieId = new Map<string, number>();
      for (const [qid, info] of upsertedMap.entries()) {
        qidToMovieId.set(qid, info.id);
      }
      await upsertCreditsBatch(conn, qidToMovieId, creditsByFilm);

      console.log(
        `[nightly] Upserted ${movieRows.length} delta films and ${embeddingsToUpsert.length} embeddings.`,
      );
    }

    const nowIso = new Date().toISOString();
    await setPipelineState(conn, 'last_wikidata_sync', {
      completedAt: nowIso,
      deltaCount: deltaFilms.length,
    });
    console.log(`[nightly] Recorded heartbeat in pipeline_state at ${nowIso}.`);
  } finally {
    await conn.close();
  }
}

if (import.meta.main) {
  runNightlyDelta().catch((err: unknown) => {
    console.error('[nightly] Fatal error:', err);
    process.exit(1);
  });
}
