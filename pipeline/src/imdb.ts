import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { createGunzip } from 'node:zlib';

export const IMDB_RATINGS_URL = 'https://datasets.imdbws.com/title.ratings.tsv.gz';

export interface ImdbRatingRecord {
  readonly imdbId: string;
  readonly averageRating: number;
  readonly numVotes: number;
}

export interface PopularityInputItem {
  readonly id: string | number;
  readonly imdbVotes: number | null | undefined;
  readonly sitelinks: number | null | undefined;
}

/**
 * Parses a single line from IMDb's `title.ratings.tsv` (`tconst\taverageRating\tnumVotes`).
 * Returns `null` for the header line or malformed rows.
 */
export function parseImdbRatingsLine(line: string): ImdbRatingRecord | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith('tconst')) {
    return null;
  }

  const parts = trimmed.split('\t');
  if (parts.length < 3) {
    return null;
  }

  const imdbId = parts[0]?.trim() ?? '';
  const ratingStr = parts[1]?.trim() ?? '';
  const votesStr = parts[2]?.trim() ?? '';

  if (!/^tt\d+$/i.test(imdbId)) {
    return null;
  }

  const averageRating = Number.parseFloat(ratingStr);
  const numVotes = Number.parseInt(votesStr, 10);

  if (
    !Number.isFinite(averageRating) ||
    averageRating < 0 ||
    averageRating > 10 ||
    !Number.isFinite(numVotes) ||
    numVotes < 0
  ) {
    return null;
  }

  return {
    imdbId,
    averageRating,
    numVotes,
  };
}

/**
 * Parses an entire TSV string of IMDb ratings into a Map keyed by `imdbId` (`tt...`).
 * If `filterImdbIds` is provided, only retains matching IDs to conserve memory.
 */
export function parseImdbRatingsTsv(
  tsvContent: string,
  filterImdbIds?: ReadonlySet<string>,
): Map<string, ImdbRatingRecord> {
  const map = new Map<string, ImdbRatingRecord>();
  const lines = tsvContent.split(/\r?\n/);

  for (const line of lines) {
    const record = parseImdbRatingsLine(line);
    if (!record) {
      continue;
    }
    if (filterImdbIds && !filterImdbIds.has(record.imdbId)) {
      continue;
    }
    map.set(record.imdbId, record);
  }

  return map;
}

/**
 * Streams and gunzips `title.ratings.tsv.gz` from either a URL or local file path,
 * parsing rows line-by-line without buffering the full decompressed file in memory.
 */
export async function streamImdbRatings(options: {
  url?: string;
  filePath?: string;
  filterImdbIds?: ReadonlySet<string>;
  fetchImpl?: typeof fetch;
} = {}): Promise<Map<string, ImdbRatingRecord>> {
  const map = new Map<string, ImdbRatingRecord>();
  let nodeStream: NodeJS.ReadableStream;

  if (options.filePath) {
    const fileStream = createReadStream(options.filePath);
    nodeStream = options.filePath.endsWith('.gz') ? fileStream.pipe(createGunzip()) : fileStream;
  } else {
    const url = options.url ?? IMDB_RATINGS_URL;
    const fetchFn = options.fetchImpl ?? fetch;
    const response = await fetchFn(url);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download IMDb ratings (${response.status} ${response.statusText})`);
    }
    const rawReadable = Readable.fromWeb(
      response.body as unknown as WebReadableStream,
    );
    nodeStream = url.endsWith('.gz') ? rawReadable.pipe(createGunzip()) : rawReadable;
  }

  const rl = createInterface({
    input: nodeStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const parsed = parseImdbRatingsLine(line);
    if (!parsed) {
      continue;
    }
    if (options.filterImdbIds && !options.filterImdbIds.has(parsed.imdbId)) {
      continue;
    }
    map.set(parsed.imdbId, parsed);
  }

  return map;
}

/**
 * Computes `raw_pop` for a single movie as specified in `recommendation-engine.md` §1.2:
 * - If `imdbVotes` is present and > 0: `ln(1 + imdbVotes)`
 * - Otherwise: `0.6 * ln(1 + 50 * max(0, sitelinks))`
 */
export function computeRawPopularity(
  imdbVotes: number | null | undefined,
  sitelinks: number | null | undefined,
): number {
  if (typeof imdbVotes === 'number' && Number.isFinite(imdbVotes) && imdbVotes > 0) {
    return Math.log(1 + imdbVotes);
  }
  const safeSitelinks =
    typeof sitelinks === 'number' && Number.isFinite(sitelinks) && sitelinks > 0 ? sitelinks : 0;
  return 0.6 * Math.log(1 + 50 * safeSitelinks);
}

/**
 * Converts `raw_pop` across a catalog of items into a uniform percentile `popularity_pct` in `[0, 1]`.
 * Ties receive their average percentile rank so identical raw popularity values map to identical percentiles.
 */
export function computePopularityPercentiles<T extends PopularityInputItem>(
  items: readonly T[],
): Map<T['id'], number> {
  const result = new Map<T['id'], number>();
  const n = items.length;
  if (n === 0) {
    return result;
  }
  if (n === 1) {
    const only = items[0];
    if (only) {
      result.set(only.id, 0.5);
    }
    return result;
  }

  const scored = items.map((item) => ({
    id: item.id,
    rawPop: computeRawPopularity(item.imdbVotes, item.sitelinks),
  }));

  scored.sort((a, b) => a.rawPop - b.rawPop);

  let i = 0;
  while (i < n) {
    let j = i;
    const currentVal = scored[i]?.rawPop ?? 0;
    while (j + 1 < n && Math.abs((scored[j + 1]?.rawPop ?? 0) - currentVal) <= 1e-12) {
      j += 1;
    }
    const meanRank = (i + j) / 2;
    const pct = Math.min(1, Math.max(0, meanRank / (n - 1)));
    for (let k = i; k <= j; k += 1) {
      const entry = scored[k];
      if (entry) {
        result.set(entry.id, Number(pct.toFixed(6)));
      }
    }
    i = j + 1;
  }

  return result;
}
