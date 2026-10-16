import { createHash } from 'node:crypto';

export const MIN_PLOT_WORDS = 60;

export interface StoryHeaderInput {
  readonly genres?: readonly string[];
  readonly subjects?: readonly string[];
  readonly settings?: readonly string[];
}

/**
 * Cleans raw Wikipedia plot section text:
 * - Removes wiki tables `{| ... |}` and templates `{{ ... }}`
 * - Removes sub-headers (`=== ... ===`)
 * - Removes citation brackets (`[1]`, `[a]`, `[citation needed]`, `[note 2]`, etc.)
 * - Removes parenthetical actor credits (`(Brad Pitt)`, `(played by ...)`, `(voiced by ...)`)
 * - Strips residual wiki formatting (`'''`, `''`) and HTML tags
 * - Normalizes whitespace while preserving paragraph breaks (`\n\n`)
 */
export function cleanPlotText(raw: string): string {
  if (!raw) {
    return '';
  }

  let text = raw.replace(/\r\n?/g, '\n');

  // Remove MediaWiki tables {| ... |}
  text = text.replace(/\{\|[\s\S]*?\|\}/g, ' ');

  // Remove MediaWiki templates {{ ... }} (up to 2 levels of nesting)
  text = text.replace(/\{\{[^{}]*\}\}/g, ' ');
  text = text.replace(/\{\{[^{}]*\}\}/g, ' ');

  // Remove MediaWiki sub-headings (=== Part 1 ===, ==== Epilogue ====)
  text = text.replace(/^={2,6}\s*.*?\s*={2,6}\s*$/gm, '\n\n');

  // Remove HTML tags if any leaked through
  text = text.replace(/<[^>]+>/g, ' ');

  // Remove wiki bold/italic quotes
  text = text.replace(/'{2,5}/g, '');

  // Remove citation markers like [1], [12], [a], [nb 1], [citation needed], [clarification needed]
  text = text.replace(
    /\[\s*(?:\d+|[a-z]|(?:nb|note)\s*\d+|citation needed|clarification needed|when\?|who\?|by whom\?|original research\?)\s*\]/gi,
    '',
  );

  // Remove explicit parenthetical actor/voice credits: (played by ...), (portrayed by ...), (voiced by ...)
  text = text.replace(/\(\s*(?:played|portrayed|voiced)\s+by\s+[^)]+\)/gi, '');

  // Remove parenthetical proper-name actor credits after character names, e.g. "John Doe (Brad Pitt)" -> "John Doe"
  // Matches 1 to 4 capitalized name tokens inside parentheses (including initials, hyphens, apostrophes)
  text = text.replace(
    /\s*\(\s*[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ.'-]+(?:\s+(?:[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ.'-]+|Jr\.|Sr\.|II|III|IV)){0,3}\s*\)/g,
    '',
  );

  // Remove empty parentheses left behind
  text = text.replace(/\(\s*\)/g, '');

  // Clean up spaces before punctuation caused by stripping citations/parentheticals
  text = text.replace(/\s+([,.;:!?])/g, '$1');

  // Normalize paragraphs: split on blank lines, collapse internal whitespace per paragraph
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);

  return paragraphs.join('\n\n');
}

/**
 * Counts words in cleaned plot text.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  return trimmed.split(/\s+/).filter((token) => /[a-zA-Z0-9]/.test(token)).length;
}

/**
 * Checks whether a cleaned plot meets the minimum word requirement (>= 60 words).
 */
export function isValidPlot(cleanedPlot: string, minWords: number = MIN_PLOT_WORDS): boolean {
  return countWords(cleanedPlot) >= minWords;
}

function cleanTagList(tags?: readonly string[]): string[] {
  if (!tags || tags.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const cleaned = raw.trim();
    const key = cleaned.toLowerCase();
    if (cleaned.length > 0 && !seen.has(key)) {
      seen.add(key);
      result.push(cleaned);
    }
  }
  return result;
}

/**
 * Builds the structured Story DNA header from Wikidata genres, subjects, and settings.
 * Strictly omits empty segments and NEVER includes movie title, director, or cast names.
 *
 * Format: "Genres: a, b. Themes: c, d. Setting: e, f."
 */
export function buildStoryHeader(input: StoryHeaderInput): string {
  const segments: string[] = [];

  const genres = cleanTagList(input.genres);
  if (genres.length > 0) {
    segments.push(`Genres: ${genres.join(', ')}.`);
  }

  const subjects = cleanTagList(input.subjects);
  if (subjects.length > 0) {
    segments.push(`Themes: ${subjects.join(', ')}.`);
  }

  const settings = cleanTagList(input.settings);
  if (settings.length > 0) {
    segments.push(`Setting: ${settings.join(', ')}.`);
  }

  return segments.join(' ');
}

/**
 * Formats a single plot chunk with its structured header for embedding.
 */
export function formatChunkForEmbedding(header: string, chunk: string): string {
  const trimmedHeader = header.trim();
  const trimmedChunk = chunk.trim();
  if (trimmedHeader.length === 0) {
    return `Plot: ${trimmedChunk}`;
  }
  return `${trimmedHeader} Plot: ${trimmedChunk}`;
}

/**
 * Computes deterministic SHA-256 hex digest of the header + cleaned plot so unchanged
 * plots are never re-embedded during incremental runs.
 */
export function computePlotHash(header: string, cleanedPlot: string): string {
  return createHash('sha256')
    .update(header.trim())
    .update('\n---\n')
    .update(cleanedPlot.trim())
    .digest('hex');
}
