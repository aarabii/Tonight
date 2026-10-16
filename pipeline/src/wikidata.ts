export const QLEVER_WIKIDATA_ENDPOINT = 'https://qlever.cs.uni-freiburg.de/api/wikidata';
export const WDQS_ENDPOINT = 'https://query.wikidata.org/sparql';
export const MAX_CAST_PER_MOVIE = 15;

export type CreditRole = 'director' | 'cast' | 'writer' | 'composer';

export interface WikidataPersonCredit {
  readonly wikidataQid: string;
  readonly tmdbPersonId: number | null;
  readonly name: string;
  readonly role: CreditRole;
  readonly billing: number | null;
}

export interface WikidataFilmRecord {
  readonly wikidataQid: string;
  readonly tmdbId: number | null;
  readonly imdbId: string | null;
  readonly title: string;
  readonly originalTitle: string | null;
  readonly year: number | null;
  readonly runtimeMin: number | null;
  readonly genres: string[];
  readonly subjects: string[];
  readonly settings: string[];
  readonly languages: string[];
  readonly countries: string[];
  readonly seriesQid: string | null;
  readonly sitelinks: number | null;
  readonly enwikiTitle: string;
  readonly credits: WikidataPersonCredit[];
}

export interface SparqlBindingValue {
  readonly type: string;
  readonly value: string;
  readonly 'xml:lang'?: string;
  readonly datatype?: string;
}

export type SparqlBindingRow = Readonly<Record<string, SparqlBindingValue | undefined>>;

export interface SparqlJsonResponse {
  readonly head?: {
    readonly vars?: readonly string[];
  };
  readonly results: {
    readonly bindings: readonly SparqlBindingRow[];
  };
}

const SPARQL_PREFIXES = `
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX schema: <http://schema.org/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
`.trim();

/**
 * Extracts a Wikidata QID (e.g. "Q47703") from an entity URI or raw string.
 */
export function extractQidFromUri(raw: string | undefined | null): string | null {
  if (!raw) {
    return null;
  }
  const match = /(?:\/entity\/|^)(Q\d+)$/i.exec(raw.trim());
  return match?.[1] ? match[1].toUpperCase() : null;
}

/**
 * Extracts a 4-digit release year from an ISO/XSD date literal (e.g. "2016-11-11T00:00:00Z").
 */
export function parseYearFromIsoDate(raw: string | undefined | null): number | null {
  if (!raw) {
    return null;
  }
  const match = /^(\d{4})/.exec(raw.trim());
  if (!match?.[1]) {
    return null;
  }
  const year = Number.parseInt(match[1], 10);
  if (Number.isNaN(year) || year < 1880 || year > 2100) {
    return null;
  }
  return year;
}

/**
 * Parses a positive smallint (e.g. runtime minutes or sitelinks).
 */
export function parsePositiveSmallInt(raw: string | undefined | null): number | null {
  if (!raw) {
    return null;
  }
  const num = Math.round(Number.parseFloat(raw.trim()));
  if (!Number.isFinite(num) || num <= 0 || num > 32767) {
    return null;
  }
  return num;
}

/**
 * Parses a positive integer ID (such as TMDB movie ID P4947 or TMDB person ID P4985).
 */
export function parsePositiveIntId(raw: string | undefined | null): number | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const num = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(num) && num > 0 ? num : null;
}

/**
 * Extracts English Wikipedia article title from either `schema:name` or an `en.wikipedia.org/wiki/...` URL.
 */
export function parseEnwikiTitle(raw: string | undefined | null): string | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const wikiUrlMatch = /en\.wikipedia\.org\/wiki\/([^?#]+)/i.exec(trimmed);
  if (wikiUrlMatch?.[1]) {
    try {
      return decodeURIComponent(wikiUrlMatch[1].replace(/_/g, ' '));
    } catch {
      return wikiUrlMatch[1].replace(/_/g, ' ');
    }
  }
  return trimmed.replace(/_/g, ' ');
}

function splitDelimitedLabels(raw: string | undefined | null): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^Q\d+$/i.test(s));
}

function addUniqueStrings(target: string[], incoming: readonly string[]): void {
  const existingLower = new Set(target.map((item) => item.toLowerCase()));
  for (const item of incoming) {
    const cleaned = item.trim();
    const key = cleaned.toLowerCase();
    if (cleaned.length > 0 && !existingLower.has(key)) {
      existingLower.add(key);
      target.push(cleaned);
    }
  }
}

/**
 * Parses W3C SPARQL JSON bindings of film rows into normalized, deduplicated `WikidataFilmRecord` items.
 * Handles both pre-aggregated (`|`-delimited) and multi-row-per-film SPARQL bindings.
 */
export function parseSparqlFilmBindings(
  bindings: readonly SparqlBindingRow[],
): WikidataFilmRecord[] {
  const byQid = new Map<string, WikidataFilmRecord>();

  for (const row of bindings) {
    const qid = extractQidFromUri(row.film?.value ?? row.wikidata_qid?.value);
    const enwikiTitle = parseEnwikiTitle(
      row.enwikiTitle?.value ?? row.enwiki_title?.value ?? row.article?.value,
    );
    if (!qid || !enwikiTitle) {
      continue;
    }

    const rawTitle = (row.filmLabel?.value ?? row.title?.value ?? enwikiTitle).trim();
    // Skip untranslated QID fallback labels unless we have enwikiTitle
    const title = /^Q\d+$/i.test(rawTitle)
      ? enwikiTitle.replace(/\s*\([^)]*film[^)]*\)\s*$/i, '').trim()
      : rawTitle;

    const tmdbId = parsePositiveIntId(row.tmdbId?.value ?? row.tmdb_id?.value);
    const rawImdb = row.imdbId?.value ?? row.imdb_id?.value;
    const imdbId = rawImdb && /^tt\d+$/i.test(rawImdb.trim()) ? rawImdb.trim() : null;
    const originalTitle = (row.originalTitle?.value ?? row.original_title?.value)?.trim() || null;
    const year = parseYearFromIsoDate(row.pubDate?.value ?? row.year?.value);
    const runtimeMin = parsePositiveSmallInt(row.runtime?.value ?? row.runtime_min?.value);
    const seriesQid = extractQidFromUri(row.series?.value ?? row.series_qid?.value);
    const sitelinks = parsePositiveSmallInt(row.sitelinks?.value);

    const genres = splitDelimitedLabels(row.genres?.value ?? row.genreLabel?.value);
    const subjects = splitDelimitedLabels(row.subjects?.value ?? row.subjectLabel?.value);
    const settings = [
      ...splitDelimitedLabels(row.settings?.value ?? row.settingLabel?.value),
      ...splitDelimitedLabels(row.periods?.value ?? row.periodLabel?.value),
    ];
    const languages = splitDelimitedLabels(row.languages?.value ?? row.languageLabel?.value);
    const countries = splitDelimitedLabels(row.countries?.value ?? row.countryLabel?.value);

    const existing = byQid.get(qid);
    if (!existing) {
      const record: WikidataFilmRecord = {
        wikidataQid: qid,
        tmdbId,
        imdbId,
        title,
        originalTitle,
        year,
        runtimeMin,
        genres: [],
        subjects: [],
        settings: [],
        languages: [],
        countries: [],
        seriesQid,
        sitelinks,
        enwikiTitle,
        credits: [],
      };
      addUniqueStrings(record.genres, genres);
      addUniqueStrings(record.subjects, subjects);
      addUniqueStrings(record.settings, settings);
      addUniqueStrings(record.languages, languages);
      addUniqueStrings(record.countries, countries);
      byQid.set(qid, record);
    } else {
      addUniqueStrings(existing.genres, genres);
      addUniqueStrings(existing.subjects, subjects);
      addUniqueStrings(existing.settings, settings);
      addUniqueStrings(existing.languages, languages);
      addUniqueStrings(existing.countries, countries);

      const earliestYear =
        existing.year !== null && year !== null
          ? Math.min(existing.year, year)
          : (existing.year ?? year);

      byQid.set(qid, {
        ...existing,
        tmdbId: existing.tmdbId ?? tmdbId,
        imdbId: existing.imdbId ?? imdbId,
        originalTitle: existing.originalTitle ?? originalTitle,
        year: earliestYear,
        runtimeMin: existing.runtimeMin ?? runtimeMin,
        seriesQid: existing.seriesQid ?? seriesQid,
        sitelinks:
          existing.sitelinks !== null && sitelinks !== null
            ? Math.max(existing.sitelinks, sitelinks)
            : (existing.sitelinks ?? sitelinks),
      });
    }
  }

  return Array.from(byQid.values());
}

/**
 * Parses W3C SPARQL JSON bindings for film credits (`director`, `cast`, `writer`, `composer`)
 * and attaches them to a map of `filmQid -> WikidataPersonCredit[]`, enforcing the cap of
 * `MAX_CAST_PER_MOVIE` (15) cast members per film with 1-based billing order.
 */
export function parseSparqlCreditBindings(
  bindings: readonly SparqlBindingRow[],
  maxCastPerMovie: number = MAX_CAST_PER_MOVIE,
): Map<string, WikidataPersonCredit[]> {
  const creditsByFilm = new Map<string, WikidataPersonCredit[]>();
  const castCountByFilm = new Map<string, number>();
  const seenKeyByFilm = new Map<string, Set<string>>();

  for (const row of bindings) {
    const filmQid = extractQidFromUri(row.film?.value ?? row.movie?.value);
    const personQid = extractQidFromUri(row.person?.value ?? row.person_qid?.value);
    const rawRole = (row.role?.value ?? '').trim().toLowerCase();
    const name = (row.personLabel?.value ?? row.name?.value ?? '').trim();

    if (!filmQid || !personQid || !name || /^Q\d+$/i.test(name)) {
      continue;
    }

    if (
      rawRole !== 'director' &&
      rawRole !== 'cast' &&
      rawRole !== 'writer' &&
      rawRole !== 'composer'
    ) {
      continue;
    }

    const role = rawRole as CreditRole;
    const dedupeKey = `${personQid}:${role}`;
    let seenSet = seenKeyByFilm.get(filmQid);
    if (!seenSet) {
      seenSet = new Set<string>();
      seenKeyByFilm.set(filmQid, seenSet);
    }
    if (seenSet.has(dedupeKey)) {
      continue;
    }

    let billing = parsePositiveSmallInt(row.billing?.value ?? row.ordinal?.value);
    if (role === 'cast') {
      const currentCastCount = castCountByFilm.get(filmQid) ?? 0;
      if (currentCastCount >= maxCastPerMovie) {
        continue;
      }
      const nextCastCount = currentCastCount + 1;
      castCountByFilm.set(filmQid, nextCastCount);
      if (billing === null) {
        billing = nextCastCount;
      }
    }

    seenSet.add(dedupeKey);
    const tmdbPersonId = parsePositiveIntId(row.tmdbPersonId?.value ?? row.tmdb_person_id?.value);

    const list = creditsByFilm.get(filmQid) ?? [];
    list.push({
      wikidataQid: personQid,
      tmdbPersonId,
      name,
      role,
      billing,
    });
    creditsByFilm.set(filmQid, list);
  }

  return creditsByFilm;
}

/**
 * Attaches parsed credits onto an array of `WikidataFilmRecord` items cleanly.
 */
export function attachCreditsToFilms(
  films: readonly WikidataFilmRecord[],
  creditsByFilm: ReadonlyMap<string, readonly WikidataPersonCredit[]>,
): WikidataFilmRecord[] {
  return films.map((film) => {
    const incoming = creditsByFilm.get(film.wikidataQid);
    if (!incoming || incoming.length === 0) {
      return film;
    }
    return {
      ...film,
      credits: [...film.credits, ...incoming],
    };
  });
}

/**
 * Builds the SPARQL query for fetching bulk film catalog rows from QLever or WDQS.
 */
export function buildBulkFilmsSparqlQuery(options: { limit?: number; offset?: number } = {}): string {
  const limitClause = options.limit ? `LIMIT ${options.limit}` : '';
  const offsetClause = options.offset ? `OFFSET ${options.offset}` : '';

  return `
${SPARQL_PREFIXES}
SELECT
  ?film
  ?filmLabel
  (SAMPLE(?tmdbIdRaw) AS ?tmdbId)
  (SAMPLE(?imdbIdRaw) AS ?imdbId)
  (MIN(?pubDateRaw) AS ?pubDate)
  (SAMPLE(?runtimeRaw) AS ?runtime)
  (SAMPLE(?seriesRaw) AS ?series)
  (MAX(?sitelinksRaw) AS ?sitelinks)
  (SAMPLE(?enwikiTitleRaw) AS ?enwikiTitle)
  (GROUP_CONCAT(DISTINCT ?genreLabel; SEPARATOR="|") AS ?genres)
  (GROUP_CONCAT(DISTINCT ?subjectLabel; SEPARATOR="|") AS ?subjects)
  (GROUP_CONCAT(DISTINCT ?settingLabel; SEPARATOR="|") AS ?settings)
WHERE {
  VALUES ?filmClass { wd:Q11424 wd:Q24869 wd:Q202866 wd:Q93204 }
  ?film wdt:P31 ?filmClass .
  ?article schema:about ?film ;
           schema:isPartOf <https://en.wikipedia.org/> ;
           schema:name ?enwikiTitleRaw .
  ?film rdfs:label ?filmLabel .
  FILTER(LANG(?filmLabel) = "en")

  OPTIONAL { ?film wdt:P4947 ?tmdbIdRaw . }
  OPTIONAL { ?film wdt:P345 ?imdbIdRaw . }
  OPTIONAL { ?film wdt:P577 ?pubDateRaw . }
  OPTIONAL { ?film wdt:P2047 ?runtimeRaw . }
  OPTIONAL { ?film wdt:P179 ?seriesRaw . }
  OPTIONAL { ?film wikibase:sitelinks ?sitelinksRaw . }

  OPTIONAL {
    ?film wdt:P136 ?genre .
    ?genre rdfs:label ?genreLabel .
    FILTER(LANG(?genreLabel) = "en")
  }
  OPTIONAL {
    ?film wdt:P921 ?subject .
    ?subject rdfs:label ?subjectLabel .
    FILTER(LANG(?subjectLabel) = "en")
  }
  OPTIONAL {
    { ?film wdt:P840 ?setting . } UNION { ?film wdt:P2408 ?setting . }
    ?setting rdfs:label ?settingLabel .
    FILTER(LANG(?settingLabel) = "en")
  }
}
GROUP BY ?film ?filmLabel
${limitClause}
${offsetClause}
`.trim();
}

/**
 * Builds a delta SPARQL query for WDQS fetching films modified since `sinceIso` or matching specific QIDs.
 */
export function buildDeltaFilmsSparqlQuery(params: {
  sinceIso?: string;
  qids?: readonly string[];
  limit?: number;
}): string {
  const valuesFilter =
    params.qids && params.qids.length > 0
      ? `VALUES ?film { ${params.qids.map((q) => `wd:${q}`).join(' ')} }`
      : `VALUES ?filmClass { wd:Q11424 wd:Q24869 wd:Q202866 }\n  ?film wdt:P31 ?filmClass .`;

  const modifiedFilter = params.sinceIso
    ? `?film schema:dateModified ?modified .\n  FILTER(?modified >= "${params.sinceIso}"^^<http://www.w3.org/2001/XMLSchema#dateTime>)`
    : '';

  const limitClause = params.limit ? `LIMIT ${params.limit}` : 'LIMIT 500';

  return `
${SPARQL_PREFIXES}
SELECT
  ?film
  ?filmLabel
  ?tmdbId
  ?imdbId
  ?pubDate
  ?runtime
  ?series
  ?sitelinks
  ?enwikiTitle
  ?genreLabel
  ?subjectLabel
  ?settingLabel
  ?languageLabel
  ?countryLabel
WHERE {
  ${valuesFilter}
  ${modifiedFilter}
  ?article schema:about ?film ;
           schema:isPartOf <https://en.wikipedia.org/> ;
           schema:name ?enwikiTitle .
  ?film rdfs:label ?filmLabel .
  FILTER(LANG(?filmLabel) = "en")

  OPTIONAL { ?film wdt:P4947 ?tmdbId . }
  OPTIONAL { ?film wdt:P345 ?imdbId . }
  OPTIONAL { ?film wdt:P577 ?pubDate . }
  OPTIONAL { ?film wdt:P2047 ?runtime . }
  OPTIONAL { ?film wdt:P179 ?series . }
  OPTIONAL { ?film wikibase:sitelinks ?sitelinks . }
  OPTIONAL {
    ?film wdt:P136 ?genre .
    ?genre rdfs:label ?genreLabel .
    FILTER(LANG(?genreLabel) = "en")
  }
  OPTIONAL {
    ?film wdt:P921 ?subject .
    ?subject rdfs:label ?subjectLabel .
    FILTER(LANG(?subjectLabel) = "en")
  }
  OPTIONAL {
    { ?film wdt:P840 ?setting . } UNION { ?film wdt:P2408 ?setting . }
    ?setting rdfs:label ?settingLabel .
    FILTER(LANG(?settingLabel) = "en")
  }
  OPTIONAL {
    ?film wdt:P364 ?lang .
    ?lang rdfs:label ?languageLabel .
    FILTER(LANG(?languageLabel) = "en")
  }
  OPTIONAL {
    ?film wdt:P495 ?country .
    ?country rdfs:label ?countryLabel .
    FILTER(LANG(?countryLabel) = "en")
  }
}
${limitClause}
`.trim();
}

/**
 * Builds a SPARQL query for top credits (P57 director, P161 cast, P58 writer, P86 composer)
 * and their P4985 TMDB person IDs for a batch of film QIDs.
 */
export function buildCreditsSparqlQuery(filmQids: readonly string[]): string {
  const valuesList = filmQids.map((q) => `wd:${q}`).join(' ');
  return `
${SPARQL_PREFIXES}
SELECT ?film ?person ?personLabel ?role ?tmdbPersonId WHERE {
  VALUES ?film { ${valuesList} }
  {
    ?film wdt:P57 ?person .
    BIND("director" AS ?role)
  } UNION {
    ?film wdt:P161 ?person .
    BIND("cast" AS ?role)
  } UNION {
    ?film wdt:P58 ?person .
    BIND("writer" AS ?role)
  } UNION {
    ?film wdt:P86 ?person .
    BIND("composer" AS ?role)
  }
  ?person rdfs:label ?personLabel .
  FILTER(LANG(?personLabel) = "en")
  OPTIONAL { ?person wdt:P4985 ?tmdbPersonId . }
}
`.trim();
}

/**
 * Executes a SPARQL query against QLever or WDQS with polite User-Agent and exponential backoff.
 */
export async function querySparql(
  query: string,
  options: {
    endpoint?: string;
    userAgent?: string;
    maxRetries?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<SparqlJsonResponse> {
  const endpoint = options.endpoint ?? WDQS_ENDPOINT;
  const userAgent =
    options.userAgent ??
    process.env.WIKI_USER_AGENT ??
    'TonightBot/0.1 (https://github.com/aarabii/Tonight; contact@tonight.app)';
  const maxRetries = options.maxRetries ?? 3;
  const fetchFn = options.fetchImpl ?? fetch;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const body = new URLSearchParams({ query }).toString();
      const response = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/sparql-results+json',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': userAgent,
        },
        body,
      });

      if (response.status === 429 || response.status >= 500) {
        const retryAfterHeader = response.headers.get('retry-after');
        const retrySeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : NaN;
        const delayMs = Number.isFinite(retrySeconds)
          ? retrySeconds * 1000
          : Math.min(30_000, 1000 * Math.pow(2, attempt));
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
      }

      if (!response.ok) {
        throw new Error(`SPARQL HTTP ${response.status}: ${response.statusText}`);
      }

      return (await response.json()) as SparqlJsonResponse;
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delayMs = Math.min(15_000, 800 * Math.pow(2, attempt));
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('SPARQL query failed');
}

/**
 * Fetches bulk films from QLever (falling back to WDQS if requested) in pages.
 */
export async function fetchBulkWikidataFilms(
  options: {
    pageSize?: number;
    maxPages?: number;
    endpoint?: string;
    userAgent?: string;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<WikidataFilmRecord[]> {
  const pageSize = options.pageSize ?? 10_000;
  const maxPages = options.maxPages ?? 20;
  const endpoint = options.endpoint ?? QLEVER_WIKIDATA_ENDPOINT;

  const allFilms: WikidataFilmRecord[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const query = buildBulkFilmsSparqlQuery({
      limit: pageSize,
      offset: page * pageSize,
    });
    const response = await querySparql(query, {
      endpoint,
      userAgent: options.userAgent,
      fetchImpl: options.fetchImpl,
    });
    const parsed = parseSparqlFilmBindings(response.results.bindings);
    allFilms.push(...parsed);
    if (response.results.bindings.length < pageSize) {
      break;
    }
  }

  return allFilms;
}

/**
 * Fetches delta films modified since `sinceIso` (or specific QIDs) from WDQS.
 */
export async function fetchDeltaWikidataFilms(params: {
  sinceIso?: string;
  qids?: readonly string[];
  limit?: number;
  endpoint?: string;
  userAgent?: string;
  fetchImpl?: typeof fetch;
}): Promise<WikidataFilmRecord[]> {
  const query = buildDeltaFilmsSparqlQuery({
    sinceIso: params.sinceIso,
    qids: params.qids,
    limit: params.limit,
  });
  const response = await querySparql(query, {
    endpoint: params.endpoint ?? WDQS_ENDPOINT,
    userAgent: params.userAgent,
    fetchImpl: params.fetchImpl,
  });
  return parseSparqlFilmBindings(response.results.bindings);
}
