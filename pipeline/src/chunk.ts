export const DEFAULT_MAX_CHUNK_TOKENS = 380;

/**
 * Estimates the token count of a text string.
 * Counts whitespace-delimited words, adding subword estimates for very long tokens (> 14 chars).
 */
export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  const rawTokens = trimmed.split(/\s+/);
  let count = 0;
  for (const token of rawTokens) {
    if (token.length === 0) {
      continue;
    }
    if (token.length > 14) {
      count += Math.ceil(token.length / 8);
    } else {
      count += 1;
    }
  }
  return count;
}

/**
 * Splits a paragraph into individual sentences.
 */
export function splitIntoSentences(paragraph: string): string[] {
  const normalized = paragraph.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) {
    return [];
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“'([—-])/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length <= 1) {
    return normalized
      .split(/(?<=[.!?])\s+/g)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  return sentences;
}

function splitLongSentenceByWords(sentence: string, maxTokens: number): string[] {
  const words = sentence.trim().split(/\s+/);
  const chunks: string[] = [];
  let currentWords: string[] = [];
  let currentTokens = 0;

  for (const word of words) {
    const wordTokens = estimateTokens(word);
    if (currentWords.length > 0 && currentTokens + wordTokens > maxTokens) {
      chunks.push(currentWords.join(' '));
      currentWords = [word];
      currentTokens = wordTokens;
    } else {
      currentWords.push(word);
      currentTokens += wordTokens;
    }
  }

  if (currentWords.length > 0) {
    chunks.push(currentWords.join(' '));
  }

  return chunks;
}

function splitLongParagraphWithOverlap(paragraph: string, maxTokens: number): string[] {
  const sentences = splitIntoSentences(paragraph);
  if (sentences.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let currentSentences: string[] = [];
  let currentTokens = 0;

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence);

    if (sentenceTokens > maxTokens) {
      if (currentSentences.length > 0) {
        chunks.push(currentSentences.join(' '));
        currentSentences = [];
        currentTokens = 0;
      }
      chunks.push(...splitLongSentenceByWords(sentence, maxTokens));
      continue;
    }

    if (currentSentences.length > 0 && currentTokens + sentenceTokens > maxTokens) {
      chunks.push(currentSentences.join(' '));
      const lastSentence = currentSentences[currentSentences.length - 1];
      const lastSentenceTokens = lastSentence ? estimateTokens(lastSentence) : 0;

      // 1-sentence overlap if the trailing sentence leaves room for new content
      if (
        lastSentence &&
        currentSentences.length > 1 &&
        lastSentenceTokens + sentenceTokens <= maxTokens
      ) {
        currentSentences = [lastSentence, sentence];
        currentTokens = lastSentenceTokens + sentenceTokens;
      } else {
        currentSentences = [sentence];
        currentTokens = sentenceTokens;
      }
    } else {
      currentSentences.push(sentence);
      currentTokens += sentenceTokens;
    }
  }

  if (currentSentences.length > 0) {
    chunks.push(currentSentences.join(' '));
  }

  return chunks;
}

/**
 * Splits cleaned plot text on paragraph boundaries into chunks of at most `maxTokens` tokens
 * (default 380, leaving ~130 tokens for the Story DNA header inside gte-small's 512-token window).
 * If a single paragraph exceeds `maxTokens`, splits on sentence boundaries with a 1-sentence overlap.
 */
export function chunkByParagraph(
  plotText: string,
  maxTokens: number = DEFAULT_MAX_CHUNK_TOKENS,
): string[] {
  const trimmed = plotText.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const effectiveMax = Math.max(10, maxTokens);
  const paragraphs = trimmed
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);

  const chunks: string[] = [];
  let currentParagraphs: string[] = [];
  let currentTokens = 0;

  const flushCurrent = (): void => {
    if (currentParagraphs.length > 0) {
      chunks.push(currentParagraphs.join('\n\n'));
      currentParagraphs = [];
      currentTokens = 0;
    }
  };

  for (const paragraph of paragraphs) {
    const paragraphTokens = estimateTokens(paragraph);

    if (paragraphTokens > effectiveMax) {
      flushCurrent();
      chunks.push(...splitLongParagraphWithOverlap(paragraph, effectiveMax));
      continue;
    }

    if (currentParagraphs.length > 0 && currentTokens + paragraphTokens > effectiveMax) {
      flushCurrent();
    }

    currentParagraphs.push(paragraph);
    currentTokens += paragraphTokens;
  }

  flushCurrent();
  return chunks;
}
