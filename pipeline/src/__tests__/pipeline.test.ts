import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chunkByParagraph, estimateTokens, splitIntoSentences } from '../chunk';
import { evaluateDbSizeBytes, MAX_DB_SIZE_BYTES } from '../db-size-guard';
import {
  applyIsotropicCalibration,
  cosineSimilarity,
  formatHalfvecLiteral,
  l2Normalize,
  weightedMeanVector,
} from '../embed';
import { runOfflineEvaluation } from '../eval';
import {
  computePopularityPercentiles,
  computeRawPopularity,
  parseImdbRatingsLine,
  parseImdbRatingsTsv,
} from '../imdb';
import {
  buildStoryHeader,
  cleanPlotText,
  computePlotHash,
  countWords,
  formatChunkForEmbedding,
  isValidPlot,
} from '../plot-clean';
import {
  buildBulkFilmsSparqlQuery,
  buildCreditsSparqlQuery,
  buildDeltaFilmsSparqlQuery,
  parseSparqlCreditBindings,
  parseSparqlFilmBindings,
  type SparqlJsonResponse,
} from '../wikidata';
import {
  buildWikipediaExtractUrl,
  extractPlotSection,
  type MediaWikiQueryResponse,
} from '../wikipedia';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(CURRENT_DIR, '..', '..', 'fixtures');

describe('plot-clean', () => {
  it('strips Wikipedia [1] citations, parenthetical actor names, and markup noise', () => {
    const raw =
      'Dr. Louise Banks (Amy Adams) is recruited by Colonel Weber [1][citation needed] to decipher an alien language (played by Jeremy Renner).  \n\nShe discovers that learning Heptapod B alters linear perception of time.[2]';
    const cleaned = cleanPlotText(raw);

    expect(cleaned).not.toContain('[1]');
    expect(cleaned).not.toContain('[2]');
    expect(cleaned).not.toContain('[citation needed]');
    expect(cleaned).not.toContain('Amy Adams');
    expect(cleaned).not.toContain('Jeremy Renner');
    expect(cleaned).toContain('Dr. Louise Banks is recruited by Colonel Weber');
    expect(cleaned).toContain('learning Heptapod B alters linear perception of time.');
  });

  it('rejects plots with fewer than 60 words (has_story = false)', () => {
    const shortPlot =
      'A lonely man falls in love with an advanced operating system in near-future Los Angeles, only to discover the AI is evolving beyond human comprehension.';
    expect(countWords(shortPlot)).toBeLessThan(60);
    expect(isValidPlot(shortPlot)).toBe(false);

    const longPlot = Array.from({ length: 65 }, (_, i) => `word${i + 1}`).join(' ');
    expect(countWords(longPlot)).toBe(65);
    expect(isValidPlot(longPlot)).toBe(true);
  });

  it('builds story headers without title or cast and omits empty fields', () => {
    const fullHeader = buildStoryHeader({
      genres: ['science fiction', 'drama'],
      subjects: ['first contact', 'linguistics'],
      settings: ['Montana', 'spacecraft'],
    });
    expect(fullHeader).toBe(
      'Genres: science fiction, drama. Themes: first contact, linguistics. Setting: Montana, spacecraft.',
    );

    const partialHeader = buildStoryHeader({
      genres: ['thriller'],
      subjects: [],
      settings: ['Mumbai'],
    });
    expect(partialHeader).toBe('Genres: thriller. Setting: Mumbai.');

    const chunkFormatted = formatChunkForEmbedding(
      partialHeader,
      'A father shields his family during an investigation.',
    );
    expect(chunkFormatted).toBe(
      'Genres: thriller. Setting: Mumbai. Plot: A father shields his family during an investigation.',
    );
  });

  it('computes deterministic SHA-256 plot hashes', () => {
    const h1 = computePlotHash('Genres: drama.', 'Same plot text');
    const h2 = computePlotHash('Genres: drama.', 'Same plot text');
    const h3 = computePlotHash('Genres: drama.', 'Different plot text');

    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
    expect(h1).not.toBe(h3);
  });
});

describe('chunk', () => {
  it('splits multi-paragraph plots into chunks <= 380 tokens', () => {
    const p1 = Array.from(
      { length: 60 },
      (_, i) => `First paragraph sentence ${i + 1} explores the mystery.`,
    ).join(' ');
    const p2 = Array.from(
      { length: 60 },
      (_, i) => `Second paragraph sentence ${i + 1} resolves the conflict.`,
    ).join(' ');
    const fullPlot = `${p1}\n\n${p2}`;

    const chunks = chunkByParagraph(fullPlot, 380);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) {
      expect(estimateTokens(chunk)).toBeLessThanOrEqual(380);
      expect(countWords(chunk)).toBeGreaterThan(0);
    }
  });

  it('splits an oversized single paragraph with 1-sentence overlap', () => {
    const sentences = Array.from(
      { length: 45 },
      (_, i) =>
        `Sentence number ${i + 1} describes a crucial investigative step taken by the detective in the dark city.`,
    );
    const singleParagraph = sentences.join(' ');
    expect(splitIntoSentences(singleParagraph).length).toBe(45);

    const chunks = chunkByParagraph(singleParagraph, 200);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(estimateTokens(chunk)).toBeLessThanOrEqual(200);
    }
    // Check 1-sentence overlap between chunk 0 and chunk 1
    const firstChunkSentences = splitIntoSentences(chunks[0] ?? '');
    const lastSentenceOfFirst = firstChunkSentences[firstChunkSentences.length - 1] ?? '';
    expect(chunks[1]?.startsWith(lastSentenceOfFirst)).toBe(true);
  });
});

describe('wikidata SPARQL parser & query builders', () => {
  it('parses static Wikidata SPARQL fixture and caps cast at 15', async () => {
    const raw = await readFile(resolve(FIXTURES_DIR, 'wikidata-sparql.json'), 'utf-8');
    const json = JSON.parse(raw) as SparqlJsonResponse;

    const films = parseSparqlFilmBindings(json.results.bindings);
    expect(films.length).toBe(2);

    const arrival = films.find((f) => f.wikidataQid === 'Q20966343');
    expect(arrival).toBeDefined();
    expect(arrival?.tmdbId).toBe(329865);
    expect(arrival?.imdbId).toBe('tt2543164');
    expect(arrival?.title).toBe('Arrival');
    expect(arrival?.year).toBe(2016);
    expect(arrival?.runtimeMin).toBe(116);
    expect(arrival?.genres).toContain('science fiction film');
    expect(arrival?.subjects).toContain('first contact');
    expect(arrival?.enwikiTitle).toBe('Arrival (film)');

    // Test credit parsing & 15-cast cap
    const syntheticCastBindings = Array.from({ length: 20 }, (_, idx) => ({
      film: { type: 'uri', value: 'http://www.wikidata.org/entity/Q20966343' },
      person: { type: 'uri', value: `http://www.wikidata.org/entity/Q${1000 + idx}` },
      personLabel: { type: 'literal', value: `Actor ${idx + 1}` },
      tmdbPersonId: { type: 'literal', value: `${5000 + idx}` },
      role: { type: 'literal', value: 'cast' },
      ordinal: { type: 'literal', value: `${idx + 1}` },
    }));
    const creditsMap = parseSparqlCreditBindings([
      ...json.results.bindings,
      ...syntheticCastBindings,
    ]);
    const arrivalCredits = creditsMap.get('Q20966343') ?? [];
    const castCredits = arrivalCredits.filter((c) => c.role === 'cast');
    expect(castCredits.length).toBe(15);
    expect(castCredits[0]?.billing).toBe(1);
    expect(castCredits[14]?.billing).toBe(15);
  });

  it('builds valid SPARQL queries for bulk and nightly delta runs', () => {
    const bulkQuery = buildBulkFilmsSparqlQuery({ limit: 100, offset: 200 });
    expect(bulkQuery).toContain('LIMIT 100');
    expect(bulkQuery).toContain('OFFSET 200');
    expect(buildCreditsSparqlQuery(['Q20966343'])).toContain('wd:Q20966343');
    expect(buildDeltaFilmsSparqlQuery({ sinceIso: '2026-10-01T00:00:00Z' })).toContain(
      '2026-10-01T00:00:00Z',
    );
  });
});

describe('wikipedia section extractor', () => {
  it('extracts Plot from MediaWiki plain-text JSON fixture and strips Cast/Production sections', async () => {
    const raw = await readFile(resolve(FIXTURES_DIR, 'wikipedia-article.json'), 'utf-8');
    const json = JSON.parse(raw) as MediaWikiQueryResponse;
    const rawPages = json.query?.pages;
    const pagesList = Array.isArray(rawPages)
      ? rawPages
      : Object.values(rawPages ?? {});
    const extract = pagesList[0]?.extract ?? '';

    const plot = extractPlotSection(extract);
    expect(plot).not.toBeNull();
    expect(plot).toContain('Linguistics professor Louise Banks');
    expect(plot).toContain('circular logograms lacking linear time');
    expect(plot).not.toContain('Amy Adams as Dr. Louise Banks');
    expect(plot).not.toContain('Principal photography began in Montreal');
  });

  it('extracts Synopsis from HTML fixture with subheadings', async () => {
    const html = await readFile(resolve(FIXTURES_DIR, 'wikipedia-synopsis.html'), 'utf-8');
    const plot = extractPlotSection(html);

    expect(plot).not.toBeNull();
    expect(plot).toContain('carpenter Keller Dover');
    expect(plot).toContain('Detective Loki');
    expect(plot).not.toContain('Hugh Jackman as Keller Dover');
  });

  it('includes maxlag=5 in Wikipedia API URLs', () => {
    const url = buildWikipediaExtractUrl('Arrival (film)');
    expect(url).toContain('maxlag=5');
    expect(url).toContain('explaintext=1');
  });
});

describe('imdb ratings & popularity percentile math', () => {
  it('parses IMDb ratings TSV fixture and computes popularity_pct in [0, 1]', async () => {
    const tsv = await readFile(resolve(FIXTURES_DIR, 'imdb-ratings.tsv'), 'utf-8');
    const map = parseImdbRatingsTsv(tsv);

    expect(map.size).toBe(4);
    expect(map.get('tt2543164')?.averageRating).toBe(7.9);
    expect(map.get('tt2543164')?.numVotes).toBe(785000);
    expect(parseImdbRatingsLine('tconst\taverageRating\tnumVotes')).toBeNull();

    const rawLow = computeRawPopularity(100, 2);
    const rawHigh = computeRawPopularity(1_000_000, 95);
    expect(rawHigh).toBeGreaterThan(rawLow);

    const percentiles = computePopularityPercentiles([
      { id: 'indie', imdbVotes: 500, sitelinks: 3 },
      { id: 'mid', imdbVotes: 45_000, sitelinks: 25 },
      { id: 'blockbuster', imdbVotes: 1_500_000, sitelinks: 110 },
    ]);

    expect(percentiles.get('indie')).toBe(0);
    expect(percentiles.get('mid')).toBe(0.5);
    expect(percentiles.get('blockbuster')).toBe(1);
  });
});

describe('embed vector math & db-size-guard', () => {
  it('computes L2-normalized vectors, length-weighted means, halfvec literals, and isotropic calibration', () => {
    const v = l2Normalize([3, 4, 0]);
    expect(v[0]).toBeCloseTo(0.6, 5);
    expect(v[1]).toBeCloseTo(0.8, 5);
    expect(v[2]).toBeCloseTo(0, 5);

    const mean = weightedMeanVector(
      [
        [1, 0, 0],
        [0, 1, 0],
      ],
      [3, 1],
    );
    expect(mean[0]).toBeGreaterThan(mean[1] ?? 0);
    expect(cosineSimilarity(mean, mean)).toBeCloseTo(1.0, 5);

    const calibrated = applyIsotropicCalibration([0.8, 0.6, 0], [0.5, 0.5, 0], 0.5);
    expect(cosineSimilarity(calibrated, calibrated)).toBeCloseTo(1.0, 5);

    const literal = formatHalfvecLiteral([0.1234567, -0.5, 0]);
    expect(literal).toBe('[0.123457,-0.5,0]');
  });

  it('enforces the 450 MB database size guard threshold', () => {
    const okResult = evaluateDbSizeBytes(120 * 1024 * 1024);
    expect(okResult.withinBudget).toBe(true);

    const overResult = evaluateDbSizeBytes(MAX_DB_SIZE_BYTES + 1024);
    expect(overResult.withinBudget).toBe(false);
  });
});

describe('offline recommendation evaluation harness', () => {
  it('passes Sanity Pair, Leave-One-Out, and Discovery Dial Sensitivity suites', async () => {
    const summary = await runOfflineEvaluation();
    expect(summary.catalogSize).toBeGreaterThanOrEqual(250);
    expect(summary.sanity.positivePassRate).toBeGreaterThanOrEqual(0.9);
    expect(summary.sanity.negativePassRate).toBe(1.0);
    expect(summary.loo.relativeLiftVsGenrePop).toBeGreaterThanOrEqual(0.15);
    expect(summary.loo.relativeLiftVsSingleMean).toBeGreaterThanOrEqual(0.15);
    expect(summary.dial.popularityShift).toBeGreaterThanOrEqual(0.25);
    expect(summary.allPassed).toBe(true);
  });
});
