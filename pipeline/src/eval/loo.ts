import {
  ANCHOR_WEIGHTS,
  scoreCandidate,
  type ScoringAnchor,
  type ScoringCandidate,
} from '@tonight/shared';
import type { EmbeddedSeedMovie } from '../build-seed';
import { cosineSimilarity, l2Normalize } from '../embed';

export interface EvalProfileEntry {
  readonly title: string;
  readonly reaction: 'loved' | 'liked' | 'disliked';
  readonly isFavourite?: boolean;
}

export interface EvalUserProfile {
  readonly id: string;
  readonly label: string;
  readonly discoveryDial: number;
  readonly entries: readonly EvalProfileEntry[];
}

export interface LooMetrics {
  readonly hitAt20: number;
  readonly ndcgAt20: number;
  readonly hits: number;
  readonly totalTrials: number;
}

export interface LooEvalReport {
  readonly profileCount: number;
  readonly totalTrials: number;
  readonly tonight: LooMetrics;
  readonly genrePopularity: LooMetrics;
  readonly singleMeanVector: LooMetrics;
  readonly relativeLiftVsGenrePop: number;
  readonly relativeLiftVsSingleMean: number;
  readonly passed: boolean;
}

/**
 * 25 diverse synthetic + archetype user taste profiles.
 * Real viewers have multi-modal tastes (3 distinct narrative clusters + disliked push-away anchors),
 * which tests Tonight's multi-anchor soft-max + structural tags + negative push-away against
 * single-centroid and genre-popularity baselines.
 */
export const EVAL_USER_PROFILES: readonly EvalUserProfile[] = [
  {
    id: 'profile-01',
    label: 'First-Contact Sci-Fi, Epistolary Romance & Tactical Siege',
    discoveryDial: 0.45,
    entries: [
      { title: 'Arrival', reaction: 'loved' },
      { title: 'Contact', reaction: 'loved' },
      { title: 'The Lunchbox', reaction: 'loved' },
      { title: 'You\'ve Got Mail', reaction: 'loved' },
      { title: 'The Raid', reaction: 'loved' },
      { title: 'Dredd', reaction: 'loved' },
      { title: 'Saw', reaction: 'disliked' },
    ],
  },
  {
    id: 'profile-02',
    label: 'Nonlinear Puzzle Box, Walk-and-Talk Romance & Occult Horror',
    discoveryDial: 0.4,
    entries: [
      { title: 'Memento', reaction: 'loved' },
      { title: 'The Prestige', reaction: 'loved' },
      { title: 'Before Sunrise', reaction: 'loved' },
      { title: 'Lost in Translation', reaction: 'loved' },
      { title: 'Hereditary', reaction: 'loved' },
      { title: 'The Witch', reaction: 'loved' },
      { title: 'Superbad', reaction: 'disliked' },
    ],
  },
  {
    id: 'profile-03',
    label: 'Vigilante Father Thrillers, Quiet Grief & High-School Comedy',
    discoveryDial: 0.5,
    entries: [
      { title: 'Drishyam', reaction: 'loved' },
      { title: 'Prisoners', reaction: 'loved' },
      { title: 'Manchester by the Sea', reaction: 'loved' },
      { title: 'Ordinary People', reaction: 'loved' },
      { title: 'Superbad', reaction: 'loved' },
      { title: 'Booksmart', reaction: 'loved' },
      { title: 'Alien', reaction: 'disliked' },
    ],
  },
  {
    id: 'profile-04',
    label: 'Subconscious Dream Sci-Fi, Courtroom Justice & Cozy Romance',
    discoveryDial: 0.45,
    entries: [
      { title: 'Inception', reaction: 'loved' },
      { title: 'Paprika', reaction: 'loved' },
      { title: '12 Angry Men', reaction: 'loved' },
      { title: 'Court', reaction: 'loved' },
      { title: 'In the Mood for Love', reaction: 'loved' },
      { title: 'Brief Encounter', reaction: 'loved' },
      { title: 'The Thing', reaction: 'disliked' },
    ],
  },
  {
    id: 'profile-05',
    label: 'Artistic Obsession Psychodrama, Time-Loop Comedy & Prison Escape',
    discoveryDial: 0.45,
    entries: [
      { title: 'Black Swan', reaction: 'loved' },
      { title: 'Perfect Blue', reaction: 'loved' },
      { title: 'Groundhog Day', reaction: 'loved' },
      { title: 'Palm Springs', reaction: 'loved' },
      { title: 'The Shawshank Redemption', reaction: 'loved' },
      { title: 'Escape from Alcatraz', reaction: 'loved' },
      { title: 'Mad Max: Fury Road', reaction: 'disliked' },
    ],
  },
  {
    id: 'profile-06',
    label: 'Combat Time-Loops, Forbidden Period Romance & Mafia Sagas',
    discoveryDial: 0.4,
    entries: [
      { title: 'Edge of Tomorrow', reaction: 'loved' },
      { title: 'Source Code', reaction: 'loved' },
      { title: 'Portrait of a Lady on Fire', reaction: 'loved' },
      { title: 'Carol', reaction: 'loved' },
      { title: 'Goodfellas', reaction: 'loved' },
      { title: 'Gangs of Wasseypur', reaction: 'loved' },
      { title: 'Toy Story', reaction: 'disliked' },
    ],
  },
  {
    id: 'profile-07',
    label: 'Deep-Space Fatherhood, Class-Divide Satire & Manor Whodunits',
    discoveryDial: 0.45,
    entries: [
      { title: 'Interstellar', reaction: 'loved' },
      { title: 'Ad Astra', reaction: 'loved' },
      { title: 'Parasite', reaction: 'loved' },
      { title: 'Shoplifters', reaction: 'loved' },
      { title: 'Knives Out', reaction: 'loved' },
      { title: 'Gosford Park', reaction: 'loved' },
      { title: 'Saw', reaction: 'disliked' },
    ],
  },
  {
    id: 'profile-08',
    label: 'AI Consciousness, Investigative Journalism & Academic Rebellion',
    discoveryDial: 0.4,
    entries: [
      { title: 'Blade Runner', reaction: 'loved' },
      { title: 'Ex Machina', reaction: 'loved' },
      { title: 'Spotlight', reaction: 'loved' },
      { title: 'All the President\'s Men', reaction: 'loved' },
      { title: '3 Idiots', reaction: 'loved' },
      { title: 'Dead Poets Society', reaction: 'loved' },
      { title: 'Hereditary', reaction: 'disliked' },
    ],
  },
  {
    id: 'profile-09',
    label: 'Sci-Fi Heartbreak, Serial-Killer Noir & Mythic Underworlds',
    discoveryDial: 0.4,
    entries: [
      { title: 'Her', reaction: 'loved' },
      { title: 'Eternal Sunshine of the Spotless Mind', reaction: 'loved' },
      { title: 'Se7en', reaction: 'loved' },
      { title: 'Zodiac', reaction: 'loved' },
      { title: 'Spirited Away', reaction: 'loved' },
      { title: 'Pan\'s Labyrinth', reaction: 'loved' },
      { title: 'Die Hard', reaction: 'disliked' },
    ],
  },
  {
    id: 'profile-10',
    label: 'Forensic Profiling, Mentorship Healing & Simulated Reality',
    discoveryDial: 0.45,
    entries: [
      { title: 'Memories of Murder', reaction: 'loved' },
      { title: 'The Silence of the Lambs', reaction: 'loved' },
      { title: 'Taare Zameen Par', reaction: 'loved' },
      { title: 'Good Will Hunting', reaction: 'loved' },
      { title: 'The Truman Show', reaction: 'loved' },
      { title: 'The Matrix', reaction: 'loved' },
      { title: 'The Raid', reaction: 'disliked' },
    ],
  },
  {
    id: 'profile-11',
    label: 'Cutthroat Conservatory, Bank Heists & Alien Outpost Horror',
    discoveryDial: 0.45,
    entries: [
      { title: 'Whiplash', reaction: 'loved' },
      { title: 'Tár', reaction: 'loved' },
      { title: 'Heat', reaction: 'loved' },
      { title: 'The Town', reaction: 'loved' },
      { title: 'Alien', reaction: 'loved' },
      { title: 'The Thing', reaction: 'loved' },
      { title: 'You\'ve Got Mail', reaction: 'disliked' },
    ],
  },
  {
    id: 'profile-12',
    label: 'Undercover Mole Thrillers, Dark Crime Comedy & Walk-and-Talk Romance',
    discoveryDial: 0.45,
    entries: [
      { title: 'Infernal Affairs', reaction: 'loved' },
      { title: 'The Departed', reaction: 'loved' },
      { title: 'Andhadhun', reaction: 'loved' },
      { title: 'Fargo', reaction: 'loved' },
      { title: 'Before Sunrise', reaction: 'loved' },
      { title: 'Lost in Translation', reaction: 'loved' },
      { title: 'Alien', reaction: 'disliked' },
    ],
  },
  {
    id: 'profile-13',
    label: 'Tragic Family Mysteries, Dystopian Escort & Time-Loop Comedy',
    discoveryDial: 0.45,
    entries: [
      { title: 'Oldboy', reaction: 'loved' },
      { title: 'Incendies', reaction: 'loved' },
      { title: 'Children of Men', reaction: 'loved' },
      { title: 'Logan', reaction: 'loved' },
      { title: 'Groundhog Day', reaction: 'loved' },
      { title: 'Palm Springs', reaction: 'loved' },
      { title: 'Paddington 2', reaction: 'disliked' },
    ],
  },
  {
    id: 'profile-14',
    label: 'Body-Snatching Paranoia, Greed Epics & Epistolary Romance',
    discoveryDial: 0.5,
    entries: [
      { title: 'Get Out', reaction: 'loved' },
      { title: 'Rosemary\'s Baby', reaction: 'loved' },
      { title: 'Tumbbad', reaction: 'loved' },
      { title: 'There Will Be Blood', reaction: 'loved' },
      { title: 'The Lunchbox', reaction: 'loved' },
      { title: 'You\'ve Got Mail', reaction: 'loved' },
      { title: 'Booksmart', reaction: 'disliked' },
    ],
  },
  {
    id: 'profile-15',
    label: 'Single-Night Lone-Hero Action, Courtroom Drama & First-Contact Sci-Fi',
    discoveryDial: 0.5,
    entries: [
      { title: 'Die Hard', reaction: 'loved' },
      { title: 'Kaithi', reaction: 'loved' },
      { title: '12 Angry Men', reaction: 'loved' },
      { title: 'Court', reaction: 'loved' },
      { title: 'Arrival', reaction: 'loved' },
      { title: 'Contact', reaction: 'loved' },
      { title: 'Hereditary', reaction: 'disliked' },
    ],
  },
  {
    id: 'profile-16',
    label: 'Indian Cinema Gems, Hollywood Classics & Mind-Bending Thrillers',
    discoveryDial: 0.55,
    entries: [
      { title: 'Drishyam', reaction: 'loved' },
      { title: 'Prisoners', reaction: 'loved' },
      { title: 'Andhadhun', reaction: 'loved' },
      { title: 'Fargo', reaction: 'loved' },
      { title: 'Portrait of a Lady on Fire', reaction: 'loved' },
      { title: 'Carol', reaction: 'loved' },
      { title: 'Saw', reaction: 'disliked' },
    ],
  },
  {
    id: 'profile-17',
    label: 'Auteur Slow Cinema, Crime Epics & Cyber Simulation',
    discoveryDial: 0.5,
    entries: [
      { title: 'In the Mood for Love', reaction: 'loved' },
      { title: 'Brief Encounter', reaction: 'loved' },
      { title: 'Goodfellas', reaction: 'loved' },
      { title: 'Gangs of Wasseypur', reaction: 'loved' },
      { title: 'The Truman Show', reaction: 'loved' },
      { title: 'The Matrix', reaction: 'loved' },
      { title: 'Toy Story', reaction: 'disliked' },
    ],
  },
  {
    id: 'profile-18',
    label: 'High-Rise Action, Quiet Family Grief & Musical Obsession',
    discoveryDial: 0.45,
    entries: [
      { title: 'The Raid', reaction: 'loved' },
      { title: 'Dredd', reaction: 'loved' },
      { title: 'Manchester by the Sea', reaction: 'loved' },
      { title: 'Ordinary People', reaction: 'loved' },
      { title: 'Whiplash', reaction: 'loved' },
      { title: 'Tár', reaction: 'loved' },
      { title: 'Finding Nemo', reaction: 'disliked' },
    ],
  },
  {
    id: 'profile-19',
    label: 'Dream Heists, Country-Manor Mysteries & Mentorship Dramas',
    discoveryDial: 0.4,
    entries: [
      { title: 'Inception', reaction: 'loved' },
      { title: 'Paprika', reaction: 'loved' },
      { title: 'Knives Out', reaction: 'loved' },
      { title: 'Gosford Park', reaction: 'loved' },
      { title: 'Taare Zameen Par', reaction: 'loved' },
      { title: 'Good Will Hunting', reaction: 'loved' },
      { title: 'The Thing', reaction: 'disliked' },
    ],
  },
  {
    id: 'profile-20',
    label: 'Space Exploration, Undercover Thrillers & Teen Party Comedy',
    discoveryDial: 0.4,
    entries: [
      { title: 'Interstellar', reaction: 'loved' },
      { title: 'Ad Astra', reaction: 'loved' },
      { title: 'Infernal Affairs', reaction: 'loved' },
      { title: 'The Departed', reaction: 'loved' },
      { title: 'Superbad', reaction: 'loved' },
      { title: 'Booksmart', reaction: 'loved' },
      { title: 'Rosemary\'s Baby', reaction: 'disliked' },
    ],
  },
  {
    id: 'profile-21',
    label: 'Android Ethics, Folk Horror & Academic Friendship',
    discoveryDial: 0.5,
    entries: [
      { title: 'Blade Runner', reaction: 'loved' },
      { title: 'Ex Machina', reaction: 'loved' },
      { title: 'Hereditary', reaction: 'loved' },
      { title: 'The Witch', reaction: 'loved' },
      { title: '3 Idiots', reaction: 'loved' },
      { title: 'Dead Poets Society', reaction: 'loved' },
      { title: 'Dredd', reaction: 'disliked' },
    ],
  },
  {
    id: 'profile-22',
    label: 'East Asian Social Realism, Bank Heists & Romantic Sci-Fi',
    discoveryDial: 0.45,
    entries: [
      { title: 'Parasite', reaction: 'loved' },
      { title: 'Shoplifters', reaction: 'loved' },
      { title: 'Heat', reaction: 'loved' },
      { title: 'The Town', reaction: 'loved' },
      { title: 'Her', reaction: 'loved' },
      { title: 'Eternal Sunshine of the Spotless Mind', reaction: 'loved' },
      { title: 'Saw', reaction: 'disliked' },
    ],
  },
  {
    id: 'profile-23',
    label: 'Journalistic Exposés, Mythic Fantasy & Combat Loops',
    discoveryDial: 0.4,
    entries: [
      { title: 'Spotlight', reaction: 'loved' },
      { title: 'All the President\'s Men', reaction: 'loved' },
      { title: 'Spirited Away', reaction: 'loved' },
      { title: 'Pan\'s Labyrinth', reaction: 'loved' },
      { title: 'Edge of Tomorrow', reaction: 'loved' },
      { title: 'Source Code', reaction: 'loved' },
      { title: 'Se7en', reaction: 'disliked' },
    ],
  },
  {
    id: 'profile-24',
    label: 'Psychological Performer Horror, Prison Breakouts & Lone-Hero Action',
    discoveryDial: 0.45,
    entries: [
      { title: 'Black Swan', reaction: 'loved' },
      { title: 'Perfect Blue', reaction: 'loved' },
      { title: 'The Shawshank Redemption', reaction: 'loved' },
      { title: 'Escape from Alcatraz', reaction: 'loved' },
      { title: 'Die Hard', reaction: 'loved' },
      { title: 'Kaithi', reaction: 'loved' },
      { title: 'Brief Encounter', reaction: 'disliked' },
    ],
  },
  {
    id: 'profile-25',
    label: 'Serial-Killer Investigations, Greed Cautionary Tales & Dystopian Hope',
    discoveryDial: 0.45,
    entries: [
      { title: 'Memories of Murder', reaction: 'loved' },
      { title: 'The Silence of the Lambs', reaction: 'loved' },
      { title: 'Tumbbad', reaction: 'loved' },
      { title: 'There Will Be Blood', reaction: 'loved' },
      { title: 'Children of Men', reaction: 'loved' },
      { title: 'Logan', reaction: 'loved' },
      { title: 'Superbad', reaction: 'disliked' },
    ],
  },
] as const;

export const LOO_MIN_RELATIVE_LIFT = 0.15;

function anchorWeight(entry: EvalProfileEntry): number {
  if (entry.reaction === 'disliked') {
    return ANCHOR_WEIGHTS.disliked;
  }
  if (entry.isFavourite) {
    return ANCHOR_WEIGHTS.favourite;
  }
  return entry.reaction === 'loved' ? ANCHOR_WEIGHTS.loved : ANCHOR_WEIGHTS.liked;
}

/**
 * Baseline 1: Genre popularity.
 * Ranks candidates by genre overlap with the user's positive training anchors,
 * weighted by global popularity (`popularityPct`).
 */
function rankByGenrePopularity(
  positiveTrainMovies: readonly EmbeddedSeedMovie[],
  candidates: readonly EmbeddedSeedMovie[],
): number[] {
  const genreCounts = new Map<string, number>();
  for (const m of positiveTrainMovies) {
    for (const g of m.genres) {
      const key = g.toLowerCase();
      genreCounts.set(key, (genreCounts.get(key) ?? 0) + 1);
    }
  }

  const scored = candidates.map((c) => {
    let genreMatchScore = 0;
    for (const g of c.genres) {
      genreMatchScore += genreCounts.get(g.toLowerCase()) ?? 0;
    }
    const score = genreMatchScore * 0.25 + c.popularityPct;
    return { id: c.id, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.id);
}

/**
 * Baseline 2: Single mean vector.
 * Collapses all of the user's positive training anchors into a single L2-normalized centroid
 * vector and ranks candidates purely by cosine similarity to that mean centroid.
 */
function rankBySingleMeanVector(
  positiveTrainMovies: readonly EmbeddedSeedMovie[],
  candidates: readonly EmbeddedSeedMovie[],
): number[] {
  const dim = positiveTrainMovies[0]?.embedding.length ?? 384;
  const sumVec = new Array<number>(dim).fill(0);

  for (const m of positiveTrainMovies) {
    for (let i = 0; i < dim; i += 1) {
      sumVec[i] = (sumVec[i] ?? 0) + (m.embedding[i] ?? 0);
    }
  }
  const centroid = l2Normalize(sumVec);

  const scored = candidates.map((c) => ({
    id: c.id,
    score: cosineSimilarity(c.embedding, centroid),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.id);
}

/**
 * Tonight full multi-anchor recommendation scorer (`scoreCandidate` from `@tonight/shared`).
 */
function rankByTonightScorer(
  trainEntries: readonly { entry: EvalProfileEntry; movie: EmbeddedSeedMovie }[],
  candidates: readonly EmbeddedSeedMovie[],
  discoveryDial: number,
): number[] {
  const anchors: ScoringAnchor[] = trainEntries.map(({ entry, movie }) => ({
    movieId: movie.id,
    title: movie.title,
    weight: anchorWeight(entry),
    subjects: movie.subjects,
    settings: movie.settings,
  }));

  // Collect favourite directors from the user's loved training films
  const favouritePersonIds = new Set<number>();
  for (const { entry, movie } of trainEntries) {
    if (entry.reaction === 'loved') {
      for (const dirId of movie.directorIds) {
        favouritePersonIds.add(dirId);
      }
    }
  }

  const scored = candidates.map((c) => {
    const anchorSimilarities: Record<number, number> = {};
    for (const { movie } of trainEntries) {
      anchorSimilarities[movie.id] = cosineSimilarity(c.embedding, movie.embedding);
    }

    const candidateInput: ScoringCandidate = {
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

    return scoreCandidate(candidateInput, {
      anchors,
      favouritePersonIds,
      discoveryDial,
    });
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.movieId);
}

function computeRankMetrics(rankedIds: readonly number[], targetId: number, k: number = 20): {
  hit: number;
  ndcg: number;
} {
  const index = rankedIds.indexOf(targetId);
  if (index === -1 || index >= k) {
    return { hit: 0, ndcg: 0 };
  }
  const rank1Based = index + 1;
  const ndcg = 1 / Math.log2(rank1Based + 1);
  return { hit: 1, ndcg };
}

/**
 * Evaluates Leave-One-Out (`Hit@20` and `nDCG@20`) across all 25 user profiles.
 * For each profile, holds out 1 `loved` film at a time and ranks all unseen catalog films.
 */
export function evaluateLeaveOneOut(movies: readonly EmbeddedSeedMovie[]): LooEvalReport {
  const byTitle = new Map<string, EmbeddedSeedMovie>();
  for (const m of movies) {
    byTitle.set(m.title.toLowerCase(), m);
  }

  let totalTrials = 0;
  let tonightHits = 0;
  let tonightNdcgSum = 0;

  let genrePopHits = 0;
  let genrePopNdcgSum = 0;

  let singleMeanHits = 0;
  let singleMeanNdcgSum = 0;

  for (const profile of EVAL_USER_PROFILES) {
    const resolvedEntries = profile.entries.map((entry) => {
      const movie = byTitle.get(entry.title.toLowerCase());
      if (!movie) {
        throw new Error(`LOO profile ${profile.id} references missing movie: "${entry.title}"`);
      }
      return { entry, movie };
    });

    for (let holdoutIdx = 0; holdoutIdx < resolvedEntries.length; holdoutIdx += 1) {
      const heldOut = resolvedEntries[holdoutIdx];
      if (!heldOut || heldOut.entry.reaction !== 'loved') {
        continue;
      }

      const trainSet = resolvedEntries.filter((_, idx) => idx !== holdoutIdx);
      const positiveTrainMovies = trainSet
        .filter((item) => item.entry.reaction !== 'disliked')
        .map((item) => item.movie);

      const watchedTrainIds = new Set(trainSet.map((item) => item.movie.id));
      const candidatePool = movies.filter((m) => !watchedTrainIds.has(m.id));

      const tonightRanked = rankByTonightScorer(trainSet, candidatePool, profile.discoveryDial);
      const genrePopRanked = rankByGenrePopularity(positiveTrainMovies, candidatePool);
      const singleMeanRanked = rankBySingleMeanVector(positiveTrainMovies, candidatePool);

      const tMetric = computeRankMetrics(tonightRanked, heldOut.movie.id, 20);
      const gMetric = computeRankMetrics(genrePopRanked, heldOut.movie.id, 20);
      const sMetric = computeRankMetrics(singleMeanRanked, heldOut.movie.id, 20);

      totalTrials += 1;
      tonightHits += tMetric.hit;
      tonightNdcgSum += tMetric.ndcg;

      genrePopHits += gMetric.hit;
      genrePopNdcgSum += gMetric.ndcg;

      singleMeanHits += sMetric.hit;
      singleMeanNdcgSum += sMetric.ndcg;
    }
  }

  const tonight: LooMetrics = {
    hitAt20: totalTrials > 0 ? tonightHits / totalTrials : 0,
    ndcgAt20: totalTrials > 0 ? tonightNdcgSum / totalTrials : 0,
    hits: tonightHits,
    totalTrials,
  };

  const genrePopularity: LooMetrics = {
    hitAt20: totalTrials > 0 ? genrePopHits / totalTrials : 0,
    ndcgAt20: totalTrials > 0 ? genrePopNdcgSum / totalTrials : 0,
    hits: genrePopHits,
    totalTrials,
  };

  const singleMeanVector: LooMetrics = {
    hitAt20: totalTrials > 0 ? singleMeanHits / totalTrials : 0,
    ndcgAt20: totalTrials > 0 ? singleMeanNdcgSum / totalTrials : 0,
    hits: singleMeanHits,
    totalTrials,
  };

  const relativeLiftVsGenrePop =
    genrePopularity.hitAt20 > 0
      ? (tonight.hitAt20 - genrePopularity.hitAt20) / genrePopularity.hitAt20
      : tonight.hitAt20 > 0
        ? Infinity
        : 0;

  const relativeLiftVsSingleMean =
    singleMeanVector.hitAt20 > 0
      ? (tonight.hitAt20 - singleMeanVector.hitAt20) / singleMeanVector.hitAt20
      : tonight.hitAt20 > 0
        ? Infinity
        : 0;

  const passed =
    relativeLiftVsGenrePop >= LOO_MIN_RELATIVE_LIFT &&
    relativeLiftVsSingleMean >= LOO_MIN_RELATIVE_LIFT;

  return {
    profileCount: EVAL_USER_PROFILES.length,
    totalTrials,
    tonight,
    genrePopularity,
    singleMeanVector,
    relativeLiftVsGenrePop,
    relativeLiftVsSingleMean,
    passed,
  };
}
