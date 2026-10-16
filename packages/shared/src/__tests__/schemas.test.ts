import { describe, expect, it } from 'vitest';
import { ANCHOR_WEIGHTS, MOODS, REACTIONS, SCORING_WEIGHTS } from '../constants';
import {
  blendRequestSchema,
  ensureMovieRequestSchema,
  importBatchRequestSchema,
  rating10ToReaction,
  recommendRequestSchema,
  tmdbProxyRequestSchema,
  vibeSearchRequestSchema,
  watchProvidersRegionSchema,
} from '../schemas';

describe('constants', () => {
  it('defines the 4 canonical reactions and 8 canonical moods', () => {
    expect(REACTIONS).toEqual(['loved', 'liked', 'meh', 'disliked']);
    expect(MOODS).toHaveLength(8);
    expect(ANCHOR_WEIGHTS.favourite).toBe(1.5);
    expect(SCORING_WEIGHTS.story).toBe(0.7);
  });
});

describe('rating10ToReaction', () => {
  it('maps 1..10 ratings to the 4 reactions accurately', () => {
    expect(rating10ToReaction(10)).toBe('loved');
    expect(rating10ToReaction(9)).toBe('loved');
    expect(rating10ToReaction(8)).toBe('liked');
    expect(rating10ToReaction(7)).toBe('liked');
    expect(rating10ToReaction(6)).toBe('meh');
    expect(rating10ToReaction(5)).toBe('meh');
    expect(rating10ToReaction(4)).toBe('disliked');
    expect(rating10ToReaction(1)).toBe('disliked');
    expect(rating10ToReaction(null)).toBeNull();
    expect(rating10ToReaction(undefined)).toBeNull();
  });
});

describe('Edge Function Zod schemas', () => {
  it('validates tmdb-proxy requests', () => {
    expect(
      tmdbProxyRequestSchema.parse({
        action: 'movie_details',
        tmdbId: 329865,
        region: 'in',
      }),
    ).toEqual({
      action: 'movie_details',
      tmdbId: 329865,
      region: 'IN',
    });

    expect(() =>
      tmdbProxyRequestSchema.parse({
        action: 'search_movies',
        query: '   ',
      }),
    ).toThrow();
  });

  it('validates ensure-movie, recommend, blend, vibe-search, and import-library requests', () => {
    expect(ensureMovieRequestSchema.parse({ tmdbId: 550 })).toEqual({ tmdbId: 550 });

    expect(
      recommendRequestSchema.parse({
        mode: 'tonight',
        moodId: 'mind-bending',
        maxRuntime: 120,
        onlyMyServices: true,
      }),
    ).toEqual({
      mode: 'tonight',
      moodId: 'mind-bending',
      maxRuntime: 120,
      onlyMyServices: true,
    });

    expect(blendRequestSchema.parse({ friendUsername: 'Alex_99' })).toEqual({
      friendUsername: 'alex_99',
    });

    expect(
      vibeSearchRequestSchema.parse({
        query: 'time loop thriller in a small town',
        discoveryDial: 0.7,
      }),
    ).toBeDefined();

    expect(() => vibeSearchRequestSchema.parse({ query: 'abc' })).toThrow();

    expect(
      importBatchRequestSchema.parse({
        source: 'letterboxd',
        items: [
          {
            imdbId: 'tt2543164',
            title: 'Arrival',
            year: 2016,
            status: 'watched',
            rating10: 9,
            isFavourite: true,
            watchedOn: '2024-11-15',
          },
        ],
      }),
    ).toBeDefined();
  });

  it('enforces JustWatch attribution literal on watchProvidersRegionSchema', () => {
    expect(() =>
      watchProvidersRegionSchema.parse({
        region: 'IN',
        justWatchLink: 'https://www.themoviedb.org/movie/329865/watch',
        flatrate: [],
        free: [],
        rent: [],
        buy: [],
        attribution: 'TMDB',
      }),
    ).toThrow();
  });
});
