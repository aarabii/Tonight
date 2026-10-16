import { z } from 'zod';
import {
  IMPORT_SOURCES,
  MOVIE_SOURCES,
  REACTIONS,
  REC_FEEDBACK_KINDS,
  TRACK_STATUSES,
  VISIBILITIES,
} from './constants';
import type { Reaction } from './types';

export const reactionSchema = z.enum(REACTIONS);
export const trackStatusSchema = z.enum(TRACK_STATUSES);
export const visibilitySchema = z.enum(VISIBILITIES);
export const recFeedbackKindSchema = z.enum(REC_FEEDBACK_KINDS);
export const importSourceSchema = z.enum(IMPORT_SOURCES);
export const movieSourceSchema = z.enum(MOVIE_SOURCES);

export const regionCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'Must be an ISO-3166-1 alpha-2 region code');

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, 'Username must be 3-20 lowercase alphanumeric or underscore chars');

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'BAD_REQUEST',
      'RATE_LIMITED',
      'UPSTREAM_ERROR',
    ]),
    message: z.string(),
  }),
});

export const movieSummarySchema = z.object({
  movieId: z.number().int().positive().nullable(),
  tmdbId: z.number().int().positive(),
  title: z.string(),
  year: z.number().int().nullable(),
  posterPath: z.string().nullable(),
  backdropPath: z.string().nullable(),
  genres: z.array(z.string()),
  runtimeMin: z.number().int().positive().nullable(),
  hasStory: z.boolean(),
});

export const watchProviderItemSchema = z.object({
  providerId: z.number().int().positive(),
  providerName: z.string(),
  logoPath: z.string(),
});

export const watchProvidersRegionSchema = z.object({
  region: regionCodeSchema,
  justWatchLink: z.string().url().nullable(),
  flatrate: z.array(watchProviderItemSchema),
  free: z.array(watchProviderItemSchema),
  rent: z.array(watchProviderItemSchema),
  buy: z.array(watchProviderItemSchema),
  attribution: z.literal('JustWatch'),
});

export const recommendationExplanationSchema = z.object({
  becauseMovieId: z.number().int().positive().nullable(),
  becauseTitle: z.string().nullable(),
  sharedThemes: z.array(z.string()).max(3),
  personName: z.string().optional(),
});

export const recommendedMovieSchema = movieSummarySchema.extend({
  movieId: z.number().int().positive(),
  score: z.number(),
  explanation: recommendationExplanationSchema,
});

// 1. tmdb-proxy
export const tmdbProxyRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('search_movies'),
    query: z.string().trim().min(1).max(200),
    page: z.number().int().min(1).max(500).optional(),
  }),
  z.object({
    action: z.literal('search_people'),
    query: z.string().trim().min(1).max(200),
    page: z.number().int().min(1).max(500).optional(),
  }),
  z.object({
    action: z.literal('movie_details'),
    tmdbId: z.number().int().positive(),
    region: regionCodeSchema.optional(),
  }),
  z.object({
    action: z.literal('person_details'),
    tmdbPersonId: z.number().int().positive(),
  }),
  z.object({
    action: z.literal('provider_catalog'),
    region: regionCodeSchema,
  }),
  z.object({
    action: z.literal('onboarding_picks'),
  }),
]);

export const searchMoviesResponseSchema = z.object({
  page: z.number().int().min(1),
  totalPages: z.number().int().min(0),
  results: z.array(movieSummarySchema),
});

export const personSearchResultSchema = z.object({
  tmdbPersonId: z.number().int().positive(),
  personId: z.number().int().positive().nullable(),
  name: z.string(),
  knownForDepartment: z.string(),
  profilePath: z.string().nullable(),
  knownForTitles: z.array(z.string()),
});

export const searchPeopleResponseSchema = z.object({
  page: z.number().int().min(1),
  totalPages: z.number().int().min(0),
  results: z.array(personSearchResultSchema),
});

export const movieDetailsResponseSchema = movieSummarySchema.extend({
  originalTitle: z.string().nullable(),
  tagline: z.string().nullable(),
  overview: z.string().nullable(),
  certification: z.string().nullable(),
  directors: z.array(
    z.object({
      tmdbPersonId: z.number().int().positive(),
      name: z.string(),
      profilePath: z.string().nullable(),
    }),
  ),
  cast: z.array(
    z.object({
      tmdbPersonId: z.number().int().positive(),
      name: z.string(),
      character: z.string(),
      profilePath: z.string().nullable(),
    }),
  ),
  trailerYoutubeKey: z.string().nullable(),
  providers: watchProvidersRegionSchema.nullable(),
});

export const personDetailsResponseSchema = z.object({
  tmdbPersonId: z.number().int().positive(),
  personId: z.number().int().positive().nullable(),
  name: z.string(),
  biography: z.string().nullable(),
  profilePath: z.string().nullable(),
  knownForDepartment: z.string(),
  directed: z.array(movieSummarySchema),
  acted: z.array(movieSummarySchema),
});

export const providerCatalogResponseSchema = z.object({
  region: regionCodeSchema,
  providers: z.array(watchProviderItemSchema),
});

export const onboardingPicksResponseSchema = z.object({
  movies: z.array(movieSummarySchema),
});

// 2. ensure-movie & ensure-person
export const ensureMovieRequestSchema = z.object({
  tmdbId: z.number().int().positive(),
});

export const ensureMovieResponseSchema = z.object({
  movieId: z.number().int().positive(),
  hasStory: z.boolean(),
  source: movieSourceSchema,
});

export const ensurePersonRequestSchema = z.object({
  tmdbPersonId: z.number().int().positive(),
  fallbackName: z.string().trim().min(1).max(200),
});

export const ensurePersonResponseSchema = z.object({
  personId: z.number().int().positive(),
});

// 3. recommend
export const recommendRequestSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('home'),
    forceRefresh: z.boolean().optional(),
  }),
  z.object({
    mode: z.literal('similar'),
    movieId: z.number().int().positive(),
  }),
  z.object({
    mode: z.literal('tonight'),
    moodId: z.string().trim().min(1).nullable().optional(),
    maxRuntime: z
      .union([z.literal(90), z.literal(120)])
      .nullable()
      .optional(),
    withFriendUsername: usernameSchema.nullable().optional(),
    onlyMyServices: z.boolean().optional(),
    excludeMovieIds: z.array(z.number().int().positive()).max(100).optional(),
  }),
]);

export const homeRecommendationsResponseSchema = z.object({
  discoveryDial: z.number().min(0).max(1),
  coldStart: z.boolean(),
  rows: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      subtitle: z.string().optional(),
      items: z.array(recommendedMovieSchema),
    }),
  ),
});

export const similarRecommendationsResponseSchema = z.object({
  items: z.array(recommendedMovieSchema),
});

export const tonightResponseSchema = z.object({
  hero: recommendedMovieSchema
    .extend({
      overview: z.string().nullable(),
      providers: watchProvidersRegionSchema.nullable(),
      trailerYoutubeKey: z.string().nullable(),
    })
    .nullable(),
  alternatives: z.array(recommendedMovieSchema).max(2),
});

// 4. blend
export const blendRequestSchema = z.object({
  friendUsername: usernameSchema,
  forceRefresh: z.boolean().optional(),
});

export const blendResponseSchema = z.object({
  friend: z.object({
    userId: z.string().uuid(),
    username: z.string(),
    displayName: z.string().nullable(),
    avatarUrl: z.string().nullable(),
  }),
  tasteMatchPct: z.number().min(0).max(100),
  sharedThemes: z.array(z.string()),
  forBothOfYou: z.array(recommendedMovieSchema),
  theyLovedForYou: z.array(recommendedMovieSchema),
  youLovedForThem: z.array(recommendedMovieSchema),
});

// 5. vibe-search
export const vibeSearchRequestSchema = z.object({
  query: z.string().trim().min(4).max(240),
  discoveryDial: z.number().min(0).max(1).optional(),
});

export const vibeSearchResponseSchema = z.object({
  items: z.array(recommendedMovieSchema),
});

// 6. import-library
export const importLibraryItemSchema = z.object({
  imdbId: z
    .string()
    .trim()
    .regex(/^tt\d+$/, 'Must be a valid IMDb ID (e.g. tt0111161)')
    .optional(),
  title: z.string().trim().min(1).max(500),
  year: z.number().int().min(1870).max(2100).nullable().optional(),
  status: trackStatusSchema,
  rating10: z.number().min(1).max(10).nullable().optional(),
  isFavourite: z.boolean().optional(),
  watchedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
    .nullable()
    .optional(),
});

export const importBatchRequestSchema = z.object({
  source: importSourceSchema,
  items: z.array(importLibraryItemSchema).min(1).max(200),
});

export const importBatchResponseSchema = z.object({
  importedCount: z.number().int().min(0),
  unmatchedCount: z.number().int().min(0),
  unmatched: z.array(
    z.object({
      title: z.string(),
      year: z.number().int().nullable().optional(),
    }),
  ),
});

/**
 * Maps a 1..10 rating (Letterboxd 0.5..5 stars multiplied by 2, or IMDb 1..10)
 * to Tonight's 4-reaction model:
 * - >= 9  -> 'loved'
 * - 7..8  -> 'liked'
 * - 5..6  -> 'meh'
 * - <= 4  -> 'disliked'
 * - null  -> null
 */
export function rating10ToReaction(rating10: number | null | undefined): Reaction | null {
  if (rating10 === null || rating10 === undefined || Number.isNaN(rating10)) {
    return null;
  }
  if (rating10 >= 9) {
    return 'loved';
  }
  if (rating10 >= 7) {
    return 'liked';
  }
  if (rating10 >= 5) {
    return 'meh';
  }
  return 'disliked';
}
