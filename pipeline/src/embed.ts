import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { chunkByParagraph, DEFAULT_MAX_CHUNK_TOKENS } from './chunk';
import {
  buildStoryHeader,
  formatChunkForEmbedding,
  type StoryHeaderInput,
} from './plot-clean';

export const EMBEDDING_MODEL_ID = 'Supabase/gte-small';
export const EMBEDDING_MODEL_SHORT = 'gte-small';
export const EMBEDDING_DIMENSIONS = 384;

export interface EmbeddedPlotResult {
  readonly embedding: number[];
  readonly chunks: number;
  readonly model: string;
}

export type TextEmbedderFn = (text: string) => Promise<readonly number[]>;

let cachedExtractorPromise: Promise<FeatureExtractionPipeline> | null = null;

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!cachedExtractorPromise) {
    cachedExtractorPromise = (pipeline as (task: string, model: string, options?: object) => Promise<FeatureExtractionPipeline>)(
      'feature-extraction',
      EMBEDDING_MODEL_ID,
      { dtype: 'fp32' },
    );
  }
  return cachedExtractorPromise;
}

/**
 * L2-normalizes a numeric vector to unit length.
 * If the vector norm is 0, returns a copy of the zero vector.
 */
export function l2Normalize(vec: readonly number[]): number[] {
  let sumSq = 0;
  for (const val of vec) {
    sumSq += val * val;
  }
  const norm = Math.sqrt(sumSq);
  if (!Number.isFinite(norm) || norm <= 1e-12) {
    return [...vec];
  }
  return vec.map((val) => val / norm);
}

/**
 * Computes the weighted mean across multiple equal-length vectors.
 */
export function weightedMeanVector(
  vectors: readonly (readonly number[])[],
  weights: readonly number[],
): number[] {
  if (vectors.length === 0) {
    throw new Error('Cannot compute weighted mean of empty vector list');
  }
  const first = vectors[0];
  if (!first) {
    throw new Error('Invalid first vector');
  }
  const dim = first.length;
  const accum = new Array<number>(dim).fill(0);

  let totalWeight = 0;
  for (let i = 0; i < vectors.length; i += 1) {
    const vec = vectors[i];
    if (!vec || vec.length !== dim) {
      throw new Error(`Vector dimension mismatch at index ${i}`);
    }
    const rawW = weights[i] ?? 1;
    const weight = Number.isFinite(rawW) && rawW > 0 ? rawW : 1;
    totalWeight += weight;
    for (let d = 0; d < dim; d += 1) {
      accum[d] = (accum[d] ?? 0) + (vec[d] ?? 0) * weight;
    }
  }

  if (totalWeight <= 0) {
    return accum;
  }

  for (let d = 0; d < dim; d += 1) {
    accum[d] = (accum[d] ?? 0) / totalWeight;
  }

  return accum;
}

/**
 * Computes cosine similarity between two 384-dim vectors.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i += 1) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom <= 1e-12 ? 0 : dot / denom;
}

/**
 * Formats a 384-dim vector as a pgvector `halfvec(384)` literal (`[0.123456,-0.234567,...]`).
 * Rounds to 6 decimal places (exceeding float16 precision while keeping SQL compact).
 */
export function formatHalfvecLiteral(vec: readonly number[]): string {
  return `[${vec.map((v) => Number(v.toFixed(6))).join(',')}]`;
}

const ISOTROPIC_CENTERING_ALPHA = 0.5;
let cachedConePriorPromise: Promise<readonly number[]> | null = null;

async function getRawGteEmbedding(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, {
    pooling: 'mean',
    normalize: true,
  });
  const rawData = Array.from(output.data as Float32Array);
  return l2Normalize(rawData.slice(0, EMBEDDING_DIMENSIONS));
}

async function getCanonicalConePrior(): Promise<readonly number[]> {
  if (!cachedConePriorPromise) {
    cachedConePriorPromise = (async () => {
      const { MOODS } = await import('@tonight/shared');
      const rawMoodVecs: number[][] = [];
      for (const mood of MOODS) {
        rawMoodVecs.push(await getRawGteEmbedding(mood.description));
      }
      return weightedMeanVector(
        rawMoodVecs,
        rawMoodVecs.map(() => 1),
      );
    })();
  }
  return cachedConePriorPromise;
}

/**
 * Applies partial isotropic centering (`l2Normalize(v - alpha * prior)`) to mitigate
 * transformer bi-encoder anisotropy while preserving query alignment.
 */
export function applyIsotropicCalibration(
  vec: readonly number[],
  prior: readonly number[],
  alpha: number = ISOTROPIC_CENTERING_ALPHA,
): number[] {
  const shifted = vec.map((val, idx) => val - alpha * (prior[idx] ?? 0));
  return l2Normalize(shifted);
}

/**
 * Embeds a single text string into a 384-dim L2-normalized vector using `Supabase/gte-small`.
 */
export async function embedText(text: string): Promise<number[]> {
  const [rawVec, prior] = await Promise.all([
    getRawGteEmbedding(text),
    getCanonicalConePrior(),
  ]);
  return applyIsotropicCalibration(rawVec, prior);
}

/**
 * Chunks a cleaned plot on paragraph boundaries (<= 380 tokens), prepends the Story DNA
 * header (`Genres: ... Themes: ... Setting: ... Plot: {chunk}`), embeds each chunk,
 * computes the character-length-weighted mean, and L2-normalizes the final 384-dim vector.
 */
export async function embedPlotStory(params: {
  headerInput: StoryHeaderInput;
  cleanedPlot: string;
  maxChunkTokens?: number;
  embedFn?: TextEmbedderFn;
}): Promise<EmbeddedPlotResult> {
  const header = buildStoryHeader(params.headerInput);
  const chunks = chunkByParagraph(
    params.cleanedPlot,
    params.maxChunkTokens ?? DEFAULT_MAX_CHUNK_TOKENS,
  );
  if (chunks.length === 0) {
    throw new Error('Cannot embed empty plot after chunking');
  }

  const embedder: TextEmbedderFn = params.embedFn ?? embedText;
  const chunkVectors: number[][] = [];
  const chunkWeights: number[] = [];

  for (const chunk of chunks) {
    const formatted = formatChunkForEmbedding(header, chunk);
    const vec = await embedder(formatted);
    chunkVectors.push([...vec]);
    chunkWeights.push(Math.max(1, chunk.length));
  }

  const meanVec = weightedMeanVector(chunkVectors, chunkWeights);
  const normalized = l2Normalize(meanVec);

  return {
    embedding: normalized,
    chunks: chunks.length,
    model: EMBEDDING_MODEL_SHORT,
  };
}

