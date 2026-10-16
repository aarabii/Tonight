import {
  DEFAULT_DISCOVERY_DIAL,
  MMR_CAPS_DEFAULT,
  MMR_LAMBDA_DEFAULT,
  NEGATIVE_SIM_THRESHOLD,
  QUALITY_FLOOR,
  RECENCY_DECAY_BASE,
  RECENCY_DECAY_FLOOR,
  SCORING_WEIGHTS,
  SECONDS_PER_YEAR,
  STORY_SOFTMAX_TEMP,
} from './constants';

export interface ScoringAnchor {
  readonly movieId: number;
  readonly title?: string | null;
  readonly weight: number;
  readonly subjects?: readonly string[];
  readonly settings?: readonly string[];
}

export interface ScoringCandidate {
  readonly movieId: number;
  readonly title?: string | null;
  readonly seriesQid?: string | null;
  readonly subjects?: readonly string[];
  readonly settings?: readonly string[];
  readonly directorIds?: readonly number[];
  readonly castIds?: readonly number[];
  readonly popularityPct: number;
  readonly anchorSimilarities: Readonly<Record<number, number>>;
}

export interface ScoringUserContext {
  readonly anchors: readonly ScoringAnchor[];
  readonly favouritePersonIds?: ReadonlySet<number> | readonly number[];
  readonly discoveryDial?: number;
}

export interface ScoreBreakdown {
  readonly storyScore: number;
  readonly structureScore: number;
  readonly peopleScore: number;
  readonly negativePenalty: number;
  readonly popularityAdjustment: number;
}

export interface ScoredCandidate {
  readonly movieId: number;
  readonly title: string | null;
  readonly seriesQid: string | null;
  readonly directorIds: readonly number[];
  readonly score: number;
  readonly breakdown: ScoreBreakdown;
  readonly explanation: {
    readonly becauseMovieId: number | null;
    readonly becauseTitle: string | null;
    readonly sharedThemes: string[];
  };
}

export interface MmrCandidate {
  readonly movieId: number;
  readonly score: number;
  readonly seriesQid?: string | null;
  readonly directorIds?: readonly number[];
}

export interface MmrCaps {
  readonly maxPerSeries?: number;
  readonly maxPerDirector?: number;
}

/**
 * Numerically stable temperature-scaled log-mean-exp (soft-max) over values:
 *   tau * ln( (1 / N) * sum_{i=1..N} exp(v_i / tau) )
 * Rewards a single strong story match over multiple mediocre matches.
 */
export function softMax(values: readonly number[], temp: number = STORY_SOFTMAX_TEMP): number {
  if (values.length === 0) {
    return 0;
  }
  if (temp <= 0) {
    return Math.max(...values);
  }

  let maxVal = -Infinity;
  for (const v of values) {
    if (v > maxVal) {
      maxVal = v;
    }
  }

  if (!Number.isFinite(maxVal)) {
    return 0;
  }

  let sumExp = 0;
  for (const v of values) {
    sumExp += Math.exp((v - maxVal) / temp);
  }

  return maxVal + temp * Math.log(sumExp / values.length);
}

/**
 * Set Jaccard similarity |A ∩ B| / |A ∪ B|.
 * Case-insensitive and trimmed so tag matching is resilient.
 */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) {
    return 0;
  }

  const setA = new Set<string>();
  for (const item of a) {
    const normalized = item.trim().toLowerCase();
    if (normalized.length > 0) {
      setA.add(normalized);
    }
  }

  const setB = new Set<string>();
  for (const item of b) {
    const normalized = item.trim().toLowerCase();
    if (normalized.length > 0) {
      setB.add(normalized);
    }
  }

  if (setA.size === 0 && setB.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      intersection += 1;
    }
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Computes recency decay factor for user movie interactions:
 * - Favourites never decay (returns 1.0)
 * - Otherwise max(0.4, 0.8 ^ years)
 */
export function recencyDecay(
  updatedAtIso: string,
  nowIso?: string,
  isFavourite: boolean = false,
): number {
  if (isFavourite) {
    return 1.0;
  }

  const updatedMs = Date.parse(updatedAtIso);
  const nowMs = nowIso ? Date.parse(nowIso) : Date.now();
  if (Number.isNaN(updatedMs) || Number.isNaN(nowMs)) {
    return 1.0;
  }

  const elapsedSeconds = Math.max(0, (nowMs - updatedMs) / 1000);
  const years = elapsedSeconds / SECONDS_PER_YEAR;
  return Math.max(RECENCY_DECAY_FLOOR, Math.pow(RECENCY_DECAY_BASE, years));
}

/**
 * Evaluates whether a candidate passes the quality floor before scoring:
 * (imdbRating >= 6.0 && imdbVotes >= 300) || maxAnchorSim >= 0.84 || favouritePersonHit
 */
export function passesQualityFloor(params: {
  imdbRating: number | null;
  imdbVotes: number | null;
  maxAnchorSim: number;
  favouritePersonHit?: boolean;
}): boolean {
  if (params.favouritePersonHit) {
    return true;
  }
  if (params.maxAnchorSim >= QUALITY_FLOOR.minAnchorSimOverride) {
    return true;
  }
  const rating = params.imdbRating ?? 0;
  const votes = params.imdbVotes ?? 0;
  return rating >= QUALITY_FLOOR.minImdbRating && votes >= QUALITY_FLOOR.minImdbVotes;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Scores a candidate movie against a user's positive/negative anchors, favourite people,
 * and discovery dial (0.0 = crowd favourites, 0.4 = default, 1.0 = hidden gems).
 */
export function scoreCandidate(
  candidate: ScoringCandidate,
  userContext: ScoringUserContext,
): ScoredCandidate {
  const positiveAnchors = userContext.anchors.filter((a) => a.weight > 0);
  const negativeAnchors = userContext.anchors.filter((a) => a.weight < 0);

  // 1. Story score via softMax over weighted positive anchor similarities
  const positiveMatches = positiveAnchors.map((anchor) => {
    const sim = candidate.anchorSimilarities[anchor.movieId] ?? 0;
    return {
      anchor,
      sim,
      weightedSim: anchor.weight * sim,
    };
  });

  const storyScore =
    positiveMatches.length > 0
      ? softMax(
          positiveMatches.map((m) => m.weightedSim),
          STORY_SOFTMAX_TEMP,
        )
      : 0;

  // Sort positive matches descending by weightedSim to find top 3 and best explanation anchor
  const sortedPositiveMatches = [...positiveMatches].sort((a, b) => b.weightedSim - a.weightedSim);
  const top3Anchors = sortedPositiveMatches.slice(0, 3).map((m) => m.anchor);
  const bestAnchor = sortedPositiveMatches[0]?.anchor ?? null;

  // 2. Narrative structure overlap (Jaccard of subjects ∪ settings vs top 3 positive anchors)
  const candidateSubjects = candidate.subjects ?? [];
  const candidateSettings = candidate.settings ?? [];
  const candidateTags = [...candidateSubjects, ...candidateSettings];

  const top3Tags: string[] = [];
  for (const anchor of top3Anchors) {
    if (anchor.subjects) {
      top3Tags.push(...anchor.subjects);
    }
    if (anchor.settings) {
      top3Tags.push(...anchor.settings);
    }
  }

  const structureScore = jaccard(candidateTags, top3Tags);

  // 3. Favourite people boost
  const favPeopleSet: ReadonlySet<number> =
    userContext.favouritePersonIds instanceof Set
      ? userContext.favouritePersonIds
      : new Set(userContext.favouritePersonIds ?? []);

  const directorIds = candidate.directorIds ?? [];
  const castIds = candidate.castIds ?? [];

  const hasFavDirector = directorIds.some((id) => favPeopleSet.has(id));
  let favCastCount = 0;
  for (const id of castIds) {
    if (favPeopleSet.has(id)) {
      favCastCount += 1;
    }
  }

  const peopleScore = Math.min(1.0, (hasFavDirector ? 0.7 : 0) + 0.4 * favCastCount);

  // 4. Negative push-away (only triggers when sim(c, a) > 0.72)
  let negativePenalty = 0;
  for (const negAnchor of negativeAnchors) {
    const sim = candidate.anchorSimilarities[negAnchor.movieId] ?? 0;
    if (sim > NEGATIVE_SIM_THRESHOLD) {
      const penalty = Math.abs(negAnchor.weight) * (sim - NEGATIVE_SIM_THRESHOLD);
      if (penalty > negativePenalty) {
        negativePenalty = penalty;
      }
    }
  }

  // 5. Discovery dial penalty/boost
  const dial = clamp(userContext.discoveryDial ?? DEFAULT_DISCOVERY_DIAL, 0, 1);
  const popularityPct = clamp(candidate.popularityPct, 0, 1);
  const popularityAdjustment = (2 * dial - 0.3) * popularityPct;

  // Total score
  const score =
    SCORING_WEIGHTS.story * storyScore +
    SCORING_WEIGHTS.structure * structureScore +
    SCORING_WEIGHTS.people * peopleScore -
    SCORING_WEIGHTS.negative * negativePenalty -
    SCORING_WEIGHTS.popularity * popularityAdjustment;

  // Explanation generation
  const sharedThemes: string[] = [];
  if (bestAnchor) {
    const bestAnchorTagSet = new Set(
      [...(bestAnchor.subjects ?? []), ...(bestAnchor.settings ?? [])].map((t) =>
        t.trim().toLowerCase(),
      ),
    );
    const seen = new Set<string>();
    for (const tag of candidateTags) {
      const lower = tag.trim().toLowerCase();
      if (lower.length > 0 && bestAnchorTagSet.has(lower) && !seen.has(lower)) {
        seen.add(lower);
        sharedThemes.push(tag);
        if (sharedThemes.length >= 3) {
          break;
        }
      }
    }
  }

  if (sharedThemes.length === 0) {
    for (const subject of candidateSubjects) {
      if (subject.trim().length > 0) {
        sharedThemes.push(subject);
        if (sharedThemes.length >= 3) {
          break;
        }
      }
    }
  }

  return {
    movieId: candidate.movieId,
    title: candidate.title ?? null,
    seriesQid: candidate.seriesQid ?? null,
    directorIds,
    score,
    breakdown: {
      storyScore,
      structureScore,
      peopleScore,
      negativePenalty,
      popularityAdjustment,
    },
    explanation: {
      becauseMovieId: bestAnchor?.movieId ?? null,
      becauseTitle: bestAnchor?.title ?? null,
      sharedThemes,
    },
  };
}

/**
 * Maximal Marginal Relevance (MMR) greedy re-ranking with hard diversity caps:
 * - Max `maxPerSeries` (default 1) per non-null `seriesQid`
 * - Max `maxPerDirector` (default 2) per director ID
 */
export function mmrRerank<T extends MmrCandidate>(
  candidates: readonly T[],
  simFn: (a: T, b: T) => number,
  lambda: number = MMR_LAMBDA_DEFAULT,
  limit: number = 20,
  caps: MmrCaps = MMR_CAPS_DEFAULT,
): T[] {
  if (limit <= 0 || candidates.length === 0) {
    return [];
  }

  const maxPerSeries = caps.maxPerSeries ?? MMR_CAPS_DEFAULT.maxPerSeries;
  const maxPerDirector = caps.maxPerDirector ?? MMR_CAPS_DEFAULT.maxPerDirector;

  const remaining = [...candidates];
  const selected: T[] = [];
  const seriesCounts = new Map<string, number>();
  const directorCounts = new Map<number, number>();

  const violatesCaps = (item: T): boolean => {
    const seriesQid = item.seriesQid ?? null;
    if (seriesQid !== null && seriesQid.length > 0) {
      const count = seriesCounts.get(seriesQid) ?? 0;
      if (count >= maxPerSeries) {
        return true;
      }
    }

    const directors = item.directorIds ?? [];
    for (const directorId of directors) {
      const count = directorCounts.get(directorId) ?? 0;
      if (count >= maxPerDirector) {
        return true;
      }
    }

    return false;
  };

  while (selected.length < limit && remaining.length > 0) {
    let bestIndex = -1;
    let bestMmrScore = -Infinity;

    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i];
      if (!candidate || violatesCaps(candidate)) {
        continue;
      }

      let maxSimToSelected = 0;
      if (selected.length > 0) {
        maxSimToSelected = -Infinity;
        for (const chosen of selected) {
          const sim = simFn(candidate, chosen);
          if (sim > maxSimToSelected) {
            maxSimToSelected = sim;
          }
        }
      }

      const mmrScore =
        selected.length === 0
          ? candidate.score
          : lambda * candidate.score - (1 - lambda) * maxSimToSelected;

      if (mmrScore > bestMmrScore) {
        bestMmrScore = mmrScore;
        bestIndex = i;
      }
    }

    if (bestIndex === -1) {
      break;
    }

    const chosen = remaining[bestIndex];
    remaining.splice(bestIndex, 1);

    if (!chosen) {
      break;
    }

    selected.push(chosen);

    if (chosen.seriesQid) {
      seriesCounts.set(chosen.seriesQid, (seriesCounts.get(chosen.seriesQid) ?? 0) + 1);
    }
    for (const directorId of chosen.directorIds ?? []) {
      directorCounts.set(directorId, (directorCounts.get(directorId) ?? 0) + 1);
    }
  }

  return selected;
}

/**
 * Harmonic mean for Social Blend ("For both of you"):
 *   (2 * scoreA * scoreB) / (scoreA + scoreB)
 * Collapses toward 0 when either user's normalized score is near 0.
 */
export function blendHarmonicScore(scoreA: number, scoreB: number): number {
  if (scoreA <= 0 || scoreB <= 0) {
    return 0;
  }
  const sum = scoreA + scoreB;
  if (sum === 0) {
    return 0;
  }
  return (2 * scoreA * scoreB) / sum;
}

/**
 * Maps cosine similarity between two users' mean positive anchor vectors
 * from [0.50, 0.95] -> [0, 100], clamped and rounded to integer percentage.
 */
export function tasteMatchPercent(cosineSim: number): number {
  if (Number.isNaN(cosineSim)) {
    return 0;
  }
  const mapped = ((cosineSim - 0.5) / (0.95 - 0.5)) * 100;
  return Math.round(clamp(mapped, 0, 100));
}
