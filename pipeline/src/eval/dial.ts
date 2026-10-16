import {
  ANCHOR_WEIGHTS,
  scoreCandidate,
  type ScoringAnchor,
  type ScoringCandidate,
} from '@tonight/shared';
import type { EmbeddedSeedMovie } from '../build-seed';
import { cosineSimilarity } from '../embed';
import { EVAL_USER_PROFILES, type EvalProfileEntry } from './loo';

export interface DialEvalReport {
  readonly profileCount: number;
  readonly meanPopularityDial0: number;
  readonly meanPopularityDialDefault: number;
  readonly meanPopularityDial1: number;
  readonly popularityShift: number;
  readonly minShiftThreshold: number;
  readonly passed: boolean;
}

export const DIAL_MIN_POPULARITY_SHIFT = 0.25;

function anchorWeight(entry: EvalProfileEntry): number {
  if (entry.reaction === 'disliked') {
    return ANCHOR_WEIGHTS.disliked;
  }
  if (entry.isFavourite) {
    return ANCHOR_WEIGHTS.favourite;
  }
  return entry.reaction === 'loved' ? ANCHOR_WEIGHTS.loved : ANCHOR_WEIGHTS.liked;
}

function computeTop20MeanPopularity(
  anchors: readonly ScoringAnchor[],
  anchorMovies: readonly EmbeddedSeedMovie[],
  candidates: readonly EmbeddedSeedMovie[],
  dial: number,
): number {
  const scored = candidates.map((c) => {
    const anchorSimilarities: Record<number, number> = {};
    for (const a of anchorMovies) {
      anchorSimilarities[a.id] = cosineSimilarity(c.embedding, a.embedding);
    }

    const input: ScoringCandidate = {
      movieId: c.id,
      title: c.title,
      seriesQid: c.seriesQid,
      subjects: c.subjects,
      settings: c.settings,
      directorIds: c.directorIds,
      castIds: c.castIds,
      popularityPct: c.popularityPct,
      anchorSimilarities,
    };

    const res = scoreCandidate(input, {
      anchors,
      discoveryDial: dial,
    });

    return {
      movieId: c.id,
      score: res.score,
      popularityPct: c.popularityPct,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  const top20 = scored.slice(0, 20);
  if (top20.length === 0) {
    return 0;
  }

  let sumPop = 0;
  for (const item of top20) {
    sumPop += item.popularityPct;
  }
  return sumPop / top20.length;
}

/**
 * Evaluates discovery dial sensitivity across all 25 user profiles.
 * Verifies that moving `discovery_dial` from `0.0` (Crowd favourites) to `1.0` (Hidden gems)
 * decreases the mean `popularity_pct` of top-20 recommendations by at least `0.25`.
 */
export function evaluateDialSensitivity(movies: readonly EmbeddedSeedMovie[]): DialEvalReport {
  const byTitle = new Map<string, EmbeddedSeedMovie>();
  for (const m of movies) {
    byTitle.set(m.title.toLowerCase(), m);
  }

  let sumDial0 = 0;
  let sumDialDefault = 0;
  let sumDial1 = 0;

  for (const profile of EVAL_USER_PROFILES) {
    const resolved = profile.entries.map((entry) => {
      const movie = byTitle.get(entry.title.toLowerCase());
      if (!movie) {
        throw new Error(`Dial profile ${profile.id} references missing movie: "${entry.title}"`);
      }
      return { entry, movie };
    });

    const anchors: ScoringAnchor[] = resolved.map(({ entry, movie }) => ({
      movieId: movie.id,
      title: movie.title,
      weight: anchorWeight(entry),
      subjects: movie.subjects,
      settings: movie.settings,
    }));

    const anchorMovies = resolved.map((r) => r.movie);
    const watchedIds = new Set(anchorMovies.map((m) => m.id));
    const candidates = movies.filter((m) => !watchedIds.has(m.id));

    sumDial0 += computeTop20MeanPopularity(anchors, anchorMovies, candidates, 0.0);
    sumDialDefault += computeTop20MeanPopularity(anchors, anchorMovies, candidates, 0.4);
    sumDial1 += computeTop20MeanPopularity(anchors, anchorMovies, candidates, 1.0);
  }

  const count = EVAL_USER_PROFILES.length;
  const meanPopularityDial0 = count > 0 ? sumDial0 / count : 0;
  const meanPopularityDialDefault = count > 0 ? sumDialDefault / count : 0;
  const meanPopularityDial1 = count > 0 ? sumDial1 / count : 0;
  const popularityShift = meanPopularityDial0 - meanPopularityDial1;
  const passed = popularityShift >= DIAL_MIN_POPULARITY_SHIFT;

  return {
    profileCount: count,
    meanPopularityDial0,
    meanPopularityDialDefault,
    meanPopularityDial1,
    popularityShift,
    minShiftThreshold: DIAL_MIN_POPULARITY_SHIFT,
    passed,
  };
}
