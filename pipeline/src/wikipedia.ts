import pLimit from 'p-limit';

export const WIKIPEDIA_API_ENDPOINT = 'https://en.wikipedia.org/w/api.php';
export const DEFAULT_WIKIPEDIA_CONCURRENCY = 6; // <= 8 req/s as required by phase 1 spec
export const PLOT_SECTION_TITLES = [
  'plot',
  'plot summary',
  'synopsis',
  'premise',
  'story',
  'summary',
] as const;

export interface MediaWikiExtractPage {
  readonly pageid?: number;
  readonly ns?: number;
  readonly title: string;
  readonly extract?: string;
  readonly missing?: boolean;
}

export interface MediaWikiQueryResponse {
  readonly batchcomplete?: boolean;
  readonly error?: {
    readonly code: string;
    readonly info: string;
  };
  readonly query?: {
    readonly pages?:
      | readonly MediaWikiExtractPage[]
      | Readonly<Record<string, MediaWikiExtractPage>>;
  };
}

function normalizeHeadingTitle(rawHeading: string): string {
  return rawHeading
    .replace(/<[^>]+>/g, '')
    .replace(/\[\s*edit\s*\]/gi, '')
    .replace(/[:—–-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isPlotHeading(headingText: string): boolean {
  const normalized = normalizeHeadingTitle(headingText);
  return (PLOT_SECTION_TITLES as readonly string[]).includes(normalized);
}

/**
 * Extracts the Plot / Synopsis / Premise / Plot summary / Story section from either:
 * 1. MediaWiki plain-text extract with `exsectionformat=wiki` (`== Plot ==` ... `== Cast ==`),
 *    preserving all sub-headings (`=== Part 1 ===`) inside the plot section; or
 * 2. MediaWiki/Wikipedia HTML (`<h2>...Plot...</h2>` ... `<h2>...Cast...</h2>`).
 *
 * Returns `null` if no matching plot section is found.
 */
export function extractPlotSection(articleContent: string): string | null {
  if (!articleContent || articleContent.trim().length === 0) {
    return null;
  }

  const normalized = articleContent.replace(/\r\n?/g, '\n');

  // 1. Check MediaWiki `exsectionformat=wiki` headings (`== Heading ==`)
  const wikiHeadingRegex = /^(={2,3})\s*(.+?)\s*\1\s*$/gm;
  const headings: Array<{
    level: number;
    title: string;
    startIndex: number;
    contentStartIndex: number;
  }> = [];

  let match: RegExpExecArray | null;
  while ((match = wikiHeadingRegex.exec(normalized)) !== null) {
    const marker = match[1] ?? '==';
    const rawTitle = match[2] ?? '';
    headings.push({
      level: marker.length,
      title: rawTitle,
      startIndex: match.index,
      contentStartIndex: match.index + match[0].length,
    });
  }

  if (headings.length > 0) {
    // Prefer level-2 headings first (== Plot ==), then fallback to level-3 (=== Plot ===)
    for (const targetLevel of [2, 3]) {
      for (let i = 0; i < headings.length; i += 1) {
        const current = headings[i];
        if (!current || current.level !== targetLevel || !isPlotHeading(current.title)) {
          continue;
        }

        let endIndex = normalized.length;
        for (let j = i + 1; j < headings.length; j += 1) {
          const next = headings[j];
          if (next && next.level <= targetLevel) {
            endIndex = next.startIndex;
            break;
          }
        }

        const sectionBody = normalized.slice(current.contentStartIndex, endIndex).trim();
        if (sectionBody.length > 0) {
          return sectionBody;
        }
      }
    }
  }

  // 2. Fallback: Check HTML `<h2>` / `<h3>` sections if HTML fixture is passed
  if (/<h[23]\b/i.test(normalized)) {
    const htmlHeadingRegex = /<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
    const htmlHeadings: Array<{
      level: number;
      title: string;
      startIndex: number;
      contentStartIndex: number;
    }> = [];

    let htmlMatch: RegExpExecArray | null;
    while ((htmlMatch = htmlHeadingRegex.exec(normalized)) !== null) {
      const level = Number.parseInt(htmlMatch[1] ?? '2', 10);
      const rawTitle = htmlMatch[2] ?? '';
      htmlHeadings.push({
        level,
        title: rawTitle,
        startIndex: htmlMatch.index,
        contentStartIndex: htmlMatch.index + htmlMatch[0].length,
      });
    }

    for (let i = 0; i < htmlHeadings.length; i += 1) {
      const current = htmlHeadings[i];
      if (!current || !isPlotHeading(current.title)) {
        continue;
      }

      let endIndex = normalized.length;
      for (let j = i + 1; j < htmlHeadings.length; j += 1) {
        const next = htmlHeadings[j];
        if (next && next.level <= current.level) {
          endIndex = next.startIndex;
          break;
        }
      }

      const rawHtmlSlice = normalized.slice(current.contentStartIndex, endIndex);
      const textParagraphs = rawHtmlSlice
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .trim();

      if (textParagraphs.length > 0) {
        return textParagraphs;
      }
    }
  }

  return null;
}

/**
 * Extracts the article text from a parsed MediaWiki API `action=query&prop=extracts` response.
 */
export function extractArticleTextFromApiResponse(
  response: MediaWikiQueryResponse,
): string | null {
  const pages = response.query?.pages;
  if (!pages) {
    return null;
  }

  const pageList: MediaWikiExtractPage[] = Array.isArray(pages)
    ? pages
    : Object.values(pages as Readonly<Record<string, MediaWikiExtractPage>>);

  for (const page of pageList) {
    if (!page.missing && typeof page.extract === 'string' && page.extract.trim().length > 0) {
      return page.extract;
    }
  }

  return null;
}

/**
 * Builds the MediaWiki API URL for fetching a single plain-text article with wiki-formatted section headers.
 */
export function buildWikipediaExtractUrl(
  enwikiTitle: string,
  endpoint: string = WIKIPEDIA_API_ENDPOINT,
): string {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts',
    explaintext: '1',
    exsectionformat: 'wiki',
    redirects: '1',
    format: 'json',
    formatversion: '2',
    maxlag: '5',
    titles: enwikiTitle,
  });
  return `${endpoint}?${params.toString()}`;
}

/**
 * Fetches the plot section for a single English Wikipedia article title with polite headers,
 * `maxlag=5` handling, `Retry-After` compliance, and exponential backoff.
 */
export async function fetchWikipediaPlotSection(
  enwikiTitle: string,
  options: {
    endpoint?: string;
    userAgent?: string;
    maxRetries?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<string | null> {
  const userAgent =
    options.userAgent ??
    process.env.WIKI_USER_AGENT ??
    'TonightBot/0.1 (https://github.com/aarabii/Tonight; contact@tonight.app)';
  const maxRetries = options.maxRetries ?? 4;
  const fetchFn = options.fetchImpl ?? fetch;
  const url = buildWikipediaExtractUrl(enwikiTitle, options.endpoint);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetchFn(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Api-User-Agent': userAgent,
          'User-Agent': userAgent,
        },
      });

      if (response.status === 429 || response.status >= 500) {
        const retryAfter = response.headers.get('retry-after');
        const retrySec = retryAfter ? Number.parseInt(retryAfter, 10) : NaN;
        const waitMs = Number.isFinite(retrySec)
          ? retrySec * 1000
          : Math.min(20_000, 500 * Math.pow(2, attempt));
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
        return null;
      }

      if (!response.ok) {
        throw new Error(`Wikipedia API HTTP ${response.status}: ${response.statusText}`);
      }

      const json = (await response.json()) as MediaWikiQueryResponse;
      if (json.error?.code === 'maxlag') {
        const waitMs = Math.min(20_000, 1000 * Math.pow(2, attempt));
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
        return null;
      }

      const extract = extractArticleTextFromApiResponse(json);
      if (!extract) {
        return null;
      }

      return extractPlotSection(extract);
    } catch (error) {
      if (attempt < maxRetries) {
        const waitMs = Math.min(15_000, 500 * Math.pow(2, attempt));
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      throw error;
    }
  }

  return null;
}

/**
 * Fetches plot sections for multiple Wikipedia titles with bounded concurrency (`<= 8` req/s).
 */
export async function fetchWikipediaPlotsBatch(
  enwikiTitles: readonly string[],
  options: {
    concurrency?: number;
    userAgent?: string;
    fetchImpl?: typeof fetch;
    onProgress?: (completed: number, total: number) => void;
  } = {},
): Promise<Map<string, string | null>> {
  const concurrency = Math.min(8, Math.max(1, options.concurrency ?? DEFAULT_WIKIPEDIA_CONCURRENCY));
  const limit = pLimit(concurrency);
  const results = new Map<string, string | null>();
  let completed = 0;

  await Promise.all(
    enwikiTitles.map((title) =>
      limit(async () => {
        const plot = await fetchWikipediaPlotSection(title, {
          userAgent: options.userAgent,
          fetchImpl: options.fetchImpl,
        });
        results.set(title, plot);
        completed += 1;
        options.onProgress?.(completed, enwikiTitles.length);
      }),
    ),
  );

  return results;
}
