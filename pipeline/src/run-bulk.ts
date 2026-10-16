import { embedPlotStory } from './embed';
import { computePopularityPercentiles, streamImdbRatings } from './imdb';
import {
  createPipelineDbConnection,
  readCheckpoint,
  setPipelineState,
  upsertCreditsBatch,
  upsertEmbeddingsBatch,
  upsertMoods,
  upsertMoviesBatch,
  writeCheckpoint,
  type CatalogEmbeddingUpsertRow,
  type CatalogMovieUpsertRow,
} from './load';
import { embedCanonicalMoods } from './moods';
import {
  buildStoryHeader,
  cleanPlotText,
  computePlotHash,
  isValidPlot,
} from './plot-clean';
import {
  buildCreditsSparqlQuery,
  fetchBulkWikidataFilms,
  parseSparqlCreditBindings,
  querySparql,
  type WikidataFilmRecord,
  type WikidataPersonCredit,
} from './wikidata';
import { fetchWikipediaPlotsBatch } from './wikipedia';

interface BulkCheckpoint {
  readonly completedQids: string[];
  readonly updatedAt: string;
}

/**
 * Resumable full catalog ingestion script:
 * 1. Embeds & upserts the 8 canonical moods
 * 2. Fetches Wikidata films with English Wikipedia articles (cached in `pipeline/.cache/`)
 * 3. Streams IMDb `title.ratings.tsv.gz` and computes `popularity_pct` across the catalog
 * 4. Fetches & cleans Wikipedia plots, skips `< 60` word plots (`has_story = false`),
 *    embeds chunks with `Supabase/gte-small`, and batch-upserts with local checkpointing.
 */
export async function runBulkIngest(options: {
  maxPages?: number;
  pageSize?: number;
} = {}): Promise<void> {
  const conn = createPipelineDbConnection();

  try {
    console.log('[bulk] Step 1/5: Embedding & upserting 8 canonical moods...');
    const moods = await embedCanonicalMoods();
    await upsertMoods(conn, moods);

    console.log('[bulk] Step 2/5: Loading Wikidata film catalog...');
    let films = await readCheckpoint<WikidataFilmRecord[]>('wikidata-bulk-films');
    if (!films || films.length === 0) {
      films = await fetchBulkWikidataFilms({
        pageSize: options.pageSize ?? 5000,
        maxPages: options.maxPages ?? 30,
      });
      await writeCheckpoint('wikidata-bulk-films', films);
    }
    console.log(`[bulk] Loaded ${films.length} Wikidata films.`);

    console.log('[bulk] Step 3/5: Streaming IMDb ratings & computing popularity percentiles...');
    const imdbIds = new Set(
      films.map((f) => f.imdbId).filter((id): id is string => Boolean(id)),
    );
    const imdbRatings = await streamImdbRatings({ filterImdbIds: imdbIds });
    const popularityMap = computePopularityPercentiles(
      films.map((f) => ({
        id: f.wikidataQid,
        imdbVotes: f.imdbId ? (imdbRatings.get(f.imdbId)?.numVotes ?? null) : null,
        sitelinks: f.sitelinks,
      })),
    );

    const checkpoint = (await readCheckpoint<BulkCheckpoint>('bulk-progress')) ?? {
      completedQids: [],
      updatedAt: new Date(0).toISOString(),
    };
    const completedSet = new Set(checkpoint.completedQids);
    const pendingFilms = films.filter((f) => !completedSet.has(f.wikidataQid));
    console.log(
      `[bulk] Step 4/5: Processing ${pendingFilms.length} pending films (${completedSet.size} already checkpointed)...`,
    );

    const batchSize = 100;
    for (let i = 0; i < pendingFilms.length; i += batchSize) {
      const batch = pendingFilms.slice(i, i + batchSize);
      const titles = batch.map((f) => f.enwikiTitle);
      const plotsMap = await fetchWikipediaPlotsBatch(titles);

      const movieRows: CatalogMovieUpsertRow[] = [];
      const preparedPlots = new Map<
        string,
        { cleanedPlot: string; headerInput: { genres: string[]; subjects: string[]; settings: string[] } }
      >();

      for (const film of batch) {
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
          popularityPct: popularityMap.get(film.wikidataQid) ?? 0.5,
          hasStory: hasValidStory,
          plotHash,
          enwikiTitle: film.enwikiTitle,
        });

        if (hasValidStory) {
          preparedPlots.set(film.wikidataQid, { cleanedPlot, headerInput });
        }
      }

      const upsertedMap = await upsertMoviesBatch(conn, movieRows);
      const embeddingRows: CatalogEmbeddingUpsertRow[] = [];

      for (const [qid, plotData] of preparedPlots.entries()) {
        const dbRow = upsertedMap.get(qid);
        if (!dbRow) {
          continue;
        }
        const embedded = await embedPlotStory({
          headerInput: plotData.headerInput,
          cleanedPlot: plotData.cleanedPlot,
        });
        embeddingRows.push({
          movieId: dbRow.id,
          embedding: embedded.embedding,
          model: embedded.model,
          chunks: embedded.chunks,
        });
      }

      await upsertEmbeddingsBatch(conn, embeddingRows);

      // Fetch and upsert credits for this batch
      const batchQids = batch.map((f) => f.wikidataQid);
      const creditsQuery = buildCreditsSparqlQuery(batchQids);
      const creditsResp = await querySparql(creditsQuery);
      const creditsByFilm: Map<string, WikidataPersonCredit[]> = parseSparqlCreditBindings(
        creditsResp.results.bindings,
      );
      const qidToMovieId = new Map<string, number>();
      for (const [qid, info] of upsertedMap.entries()) {
        qidToMovieId.set(qid, info.id);
      }
      await upsertCreditsBatch(conn, qidToMovieId, creditsByFilm);

      for (const qid of batchQids) {
        completedSet.add(qid);
      }
      await writeCheckpoint<BulkCheckpoint>('bulk-progress', {
        completedQids: Array.from(completedSet),
        updatedAt: new Date().toISOString(),
      });
      console.log(
        `[bulk] Progress: ${completedSet.size}/${films.length} films upserted (${embeddingRows.length} embedded in batch).`,
      );
    }

    console.log('[bulk] Step 5/5: Recording pipeline_state...');
    await setPipelineState(conn, 'last_wikidata_sync', {
      completedAt: new Date().toISOString(),
      totalFilms: films.length,
    });
    await setPipelineState(conn, 'last_imdb_sync', {
      completedAt: new Date().toISOString(),
      matchedRatings: imdbRatings.size,
    });
    console.log('[bulk] Full catalog ingestion complete.');
  } finally {
    await conn.close();
  }
}

if (import.meta.main) {
  runBulkIngest().catch((err: unknown) => {
    console.error('[bulk] Fatal error:', err);
    process.exit(1);
  });
}
