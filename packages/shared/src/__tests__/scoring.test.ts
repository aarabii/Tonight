import { describe, expect, it } from 'vitest';
import {
  blendHarmonicScore,
  jaccard,
  mmrRerank,
  passesQualityFloor,
  recencyDecay,
  scoreCandidate,
  softMax,
  tasteMatchPercent,
  type ScoringAnchor,
  type ScoringCandidate,
} from '../scoring';

describe('softMax', () => {
  it('rewards 1 strong match (0.92) over 5 weak matches (0.55)', () => {
    const singleStrong = softMax([0.92]);
    const oneStrongAmongFive = softMax([0.92, 0.4, 0.4, 0.4, 0.4]);
    const fiveWeak = softMax([0.55, 0.55, 0.55, 0.55, 0.55]);

    expect(singleStrong).toBeCloseTo(0.92, 4);
    expect(fiveWeak).toBeCloseTo(0.55, 4);
    expect(singleStrong).toBeGreaterThan(fiveWeak);
    expect(oneStrongAmongFive).toBeGreaterThan(fiveWeak);
  });

  it('returns 0 for empty input', () => {
    expect(softMax([])).toBe(0);
  });
});

describe('jaccard', () => {
  it('computes case-insensitive set intersection over union', () => {
    const a = ['Time Loop', 'Sci-Fi', 'Memory'];
    const b = ['time loop', 'thriller', 'memory'];
    // intersection = 2 (time loop, memory), union = 4
    expect(jaccard(a, b)).toBeCloseTo(0.5, 5);
  });

  it('returns 0 when both sets are empty', () => {
    expect(jaccard([], [])).toBe(0);
  });
});

describe('recencyDecay', () => {
  it('never decays when isFavourite is true', () => {
    expect(recencyDecay('2015-01-01T00:00:00Z', '2026-01-01T00:00:00Z', true)).toBe(1.0);
  });

  it('decays at 0.8^years and floors at 0.4', () => {
    const oneYear = recencyDecay('2025-01-01T00:00:00Z', '2026-01-01T06:00:00Z', false);
    expect(oneYear).toBeCloseTo(0.8, 2);

    const tenYears = recencyDecay('2010-01-01T00:00:00Z', '2026-01-01T00:00:00Z', false);
    expect(tenYears).toBe(0.4);
  });
});

describe('scoreCandidate', () => {
  const baseAnchors: ScoringAnchor[] = [
    {
      movieId: 1,
      title: 'Arrival',
      weight: 1.0,
      subjects: ['first contact', 'linguistics', 'time'],
      settings: ['montana'],
    },
  ];

  const popularCandidate: ScoringCandidate = {
    movieId: 100,
    title: 'Contact',
    subjects: ['first contact', 'science', 'faith'],
    settings: ['new mexico'],
    popularityPct: 0.95,
    anchorSimilarities: { 1: 0.86 },
  };

  it('decreases popular movie scores as discoveryDial moves from 0.0 to 1.0', () => {
    const scoreAtCrowd = scoreCandidate(popularCandidate, {
      anchors: baseAnchors,
      discoveryDial: 0.0,
    });
    const scoreAtDefault = scoreCandidate(popularCandidate, {
      anchors: baseAnchors,
      discoveryDial: 0.4,
    });
    const scoreAtHiddenGems = scoreCandidate(popularCandidate, {
      anchors: baseAnchors,
      discoveryDial: 1.0,
    });

    expect(scoreAtCrowd.score).toBeGreaterThan(scoreAtDefault.score);
    expect(scoreAtDefault.score).toBeGreaterThan(scoreAtHiddenGems.score);
  });

  it('triggers negative anchor penalty only when similarity > 0.72', () => {
    const anchorsWithNegative: ScoringAnchor[] = [
      ...baseAnchors,
      { movieId: 2, title: 'Disliked Movie', weight: -1.0 },
    ];

    const candidateAtThreshold: ScoringCandidate = {
      ...popularCandidate,
      anchorSimilarities: { 1: 0.86, 2: 0.72 },
    };

    const candidateAboveThreshold: ScoringCandidate = {
      ...popularCandidate,
      anchorSimilarities: { 1: 0.86, 2: 0.85 },
    };

    const scoredAt = scoreCandidate(candidateAtThreshold, { anchors: anchorsWithNegative });
    const scoredAbove = scoreCandidate(candidateAboveThreshold, { anchors: anchorsWithNegative });

    expect(scoredAt.breakdown.negativePenalty).toBe(0);
    expect(scoredAbove.breakdown.negativePenalty).toBeCloseTo(0.13, 5);
    expect(scoredAbove.score).toBeLessThan(scoredAt.score);
  });

  it('boosts favourite director and cast and populates explanation', () => {
    const candidateWithFavs: ScoringCandidate = {
      ...popularCandidate,
      directorIds: [10],
      castIds: [20, 21],
    };

    const scored = scoreCandidate(candidateWithFavs, {
      anchors: baseAnchors,
      favouritePersonIds: [10, 20],
    });

    // 0.7 (director) + 0.4 (1 cast) = 1.1 -> capped at 1.0
    expect(scored.breakdown.peopleScore).toBe(1.0);
    expect(scored.explanation.becauseMovieId).toBe(1);
    expect(scored.explanation.becauseTitle).toBe('Arrival');
    expect(scored.explanation.sharedThemes).toContain('first contact');
  });
});

describe('mmrRerank', () => {
  it('enforces seriesQid cap (<= 1) and director cap (<= 2)', () => {
    const candidates = [
      { movieId: 1, score: 0.95, seriesQid: 'Q_LOTR', directorIds: [500] },
      { movieId: 2, score: 0.93, seriesQid: 'Q_LOTR', directorIds: [500] }, // same series -> blocked
      { movieId: 3, score: 0.91, seriesQid: null, directorIds: [500] }, // 2nd by director 500 -> allowed
      { movieId: 4, score: 0.89, seriesQid: null, directorIds: [500] }, // 3rd by director 500 -> blocked
      { movieId: 5, score: 0.85, seriesQid: 'Q_DUNE', directorIds: [600] },
    ];

    const reranked = mmrRerank(candidates, () => 0.2, 0.72, 10);
    const ids = reranked.map((c) => c.movieId);

    expect(ids).toEqual([1, 3, 5]);
    const lotrCount = reranked.filter((c) => c.seriesQid === 'Q_LOTR').length;
    const dir500Count = reranked.filter((c) => c.directorIds?.includes(500)).length;

    expect(lotrCount).toBeLessThanOrEqual(1);
    expect(dir500Count).toBeLessThanOrEqual(2);
  });
});

describe('blendHarmonicScore', () => {
  it('penalizes lopsided pairs ((0.95, 0.05) scores much lower than (0.65, 0.65))', () => {
    const lopsided = blendHarmonicScore(0.95, 0.05);
    const balanced = blendHarmonicScore(0.65, 0.65);

    expect(lopsided).toBeCloseTo(0.095, 4);
    expect(balanced).toBeCloseTo(0.65, 4);
    expect(lopsided).toBeLessThan(balanced * 0.2);
  });

  it('returns 0 when either score is <= 0', () => {
    expect(blendHarmonicScore(0, 0.9)).toBe(0);
    expect(blendHarmonicScore(-0.2, 0.8)).toBe(0);
  });
});

describe('tasteMatchPercent & passesQualityFloor', () => {
  it('maps cosine similarity [0.50, 0.95] to [0, 100]', () => {
    expect(tasteMatchPercent(0.45)).toBe(0);
    expect(tasteMatchPercent(0.5)).toBe(0);
    expect(tasteMatchPercent(0.725)).toBe(50);
    expect(tasteMatchPercent(0.95)).toBe(100);
    expect(tasteMatchPercent(0.99)).toBe(100);
  });

  it('evaluates quality floor with overrides', () => {
    expect(passesQualityFloor({ imdbRating: 6.5, imdbVotes: 500, maxAnchorSim: 0.7 })).toBe(true);
    expect(passesQualityFloor({ imdbRating: 5.2, imdbVotes: 100, maxAnchorSim: 0.85 })).toBe(true);
    expect(
      passesQualityFloor({
        imdbRating: 5.2,
        imdbVotes: 100,
        maxAnchorSim: 0.6,
        favouritePersonHit: true,
      }),
    ).toBe(true);
    expect(passesQualityFloor({ imdbRating: 5.2, imdbVotes: 100, maxAnchorSim: 0.6 })).toBe(false);
  });
});
