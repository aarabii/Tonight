import type {
  IMPORT_SOURCES,
  MOVIE_SOURCES,
  REACTIONS,
  REC_FEEDBACK_KINDS,
  TRACK_STATUSES,
  VISIBILITIES,
} from './constants';

export type Reaction = (typeof REACTIONS)[number];
export type TrackStatus = (typeof TRACK_STATUSES)[number];
export type Visibility = (typeof VISIBILITIES)[number];
export type RecFeedbackKind = (typeof REC_FEEDBACK_KINDS)[number];
export type ImportSource = (typeof IMPORT_SOURCES)[number];
export type MovieSource = (typeof MOVIE_SOURCES)[number];

export type ApiErrorCode =
  'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'BAD_REQUEST' | 'RATE_LIMITED' | 'UPSTREAM_ERROR';

export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

export interface MovieSummary {
  movieId: number | null;
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  genres: string[];
  runtimeMin: number | null;
  hasStory: boolean;
}

export interface WatchProviderItem {
  providerId: number;
  providerName: string;
  logoPath: string;
}

export interface WatchProvidersRegion {
  region: string;
  justWatchLink: string | null;
  flatrate: WatchProviderItem[];
  free: WatchProviderItem[];
  rent: WatchProviderItem[];
  buy: WatchProviderItem[];
  attribution: 'JustWatch';
}

export interface RecommendationExplanation {
  becauseMovieId: number | null;
  becauseTitle: string | null;
  sharedThemes: string[];
  personName?: string;
}

export interface RecommendedMovie extends MovieSummary {
  movieId: number;
  score: number;
  explanation: RecommendationExplanation;
}

// 1. tmdb-proxy
export type TmdbProxyRequest =
  | { action: 'search_movies'; query: string; page?: number }
  | { action: 'search_people'; query: string; page?: number }
  | { action: 'movie_details'; tmdbId: number; region?: string }
  | { action: 'person_details'; tmdbPersonId: number }
  | { action: 'provider_catalog'; region: string }
  | { action: 'onboarding_picks' };

export interface SearchMoviesResponse {
  page: number;
  totalPages: number;
  results: MovieSummary[];
}

export interface PersonSearchResult {
  tmdbPersonId: number;
  personId: number | null;
  name: string;
  knownForDepartment: string;
  profilePath: string | null;
  knownForTitles: string[];
}

export interface SearchPeopleResponse {
  page: number;
  totalPages: number;
  results: PersonSearchResult[];
}

export interface MovieDirectorCredit {
  tmdbPersonId: number;
  name: string;
  profilePath: string | null;
}

export interface MovieCastCredit {
  tmdbPersonId: number;
  name: string;
  character: string;
  profilePath: string | null;
}

export interface MovieDetailsResponse extends MovieSummary {
  originalTitle: string | null;
  tagline: string | null;
  overview: string | null;
  certification: string | null;
  directors: MovieDirectorCredit[];
  cast: MovieCastCredit[];
  trailerYoutubeKey: string | null;
  providers: WatchProvidersRegion | null;
}

export interface PersonDetailsResponse {
  tmdbPersonId: number;
  personId: number | null;
  name: string;
  biography: string | null;
  profilePath: string | null;
  knownForDepartment: string;
  directed: MovieSummary[];
  acted: MovieSummary[];
}

export interface ProviderCatalogResponse {
  region: string;
  providers: WatchProviderItem[];
}

export interface OnboardingPicksResponse {
  movies: MovieSummary[];
}

// 2. ensure-movie & ensure-person
export interface EnsureMovieRequest {
  tmdbId: number;
}

export interface EnsureMovieResponse {
  movieId: number;
  hasStory: boolean;
  source: MovieSource;
}

export interface EnsurePersonRequest {
  tmdbPersonId: number;
  fallbackName: string;
}

export interface EnsurePersonResponse {
  personId: number;
}

// 3. recommend
export type RecommendRequest =
  | { mode: 'home'; forceRefresh?: boolean }
  | { mode: 'similar'; movieId: number }
  | {
      mode: 'tonight';
      moodId?: string | null;
      maxRuntime?: 90 | 120 | null;
      withFriendUsername?: string | null;
      onlyMyServices?: boolean;
      excludeMovieIds?: number[];
    };

export interface RecommendationRow {
  id: string;
  title: string;
  subtitle?: string;
  items: RecommendedMovie[];
}

export interface HomeRecommendationsResponse {
  discoveryDial: number;
  coldStart: boolean;
  rows: RecommendationRow[];
}

export interface SimilarRecommendationsResponse {
  items: RecommendedMovie[];
}

export type TonightHeroMovie = RecommendedMovie & {
  overview: string | null;
  providers: WatchProvidersRegion | null;
  trailerYoutubeKey: string | null;
};

export interface TonightResponse {
  hero: TonightHeroMovie | null;
  alternatives: RecommendedMovie[];
}

// 4. blend
export interface BlendRequest {
  friendUsername: string;
  forceRefresh?: boolean;
}

export interface BlendFriendSummary {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface BlendResponse {
  friend: BlendFriendSummary;
  tasteMatchPct: number;
  sharedThemes: string[];
  forBothOfYou: RecommendedMovie[];
  theyLovedForYou: RecommendedMovie[];
  youLovedForThem: RecommendedMovie[];
}

// 5. vibe-search
export interface VibeSearchRequest {
  query: string;
  discoveryDial?: number;
}

export interface VibeSearchResponse {
  items: RecommendedMovie[];
}

// 6. import-library
export interface ImportLibraryItem {
  imdbId?: string;
  title: string;
  year?: number | null;
  status: TrackStatus;
  rating10?: number | null;
  isFavourite?: boolean;
  watchedOn?: string | null;
}

export interface ImportBatchRequest {
  source: ImportSource;
  items: ImportLibraryItem[];
}

export interface ImportUnmatchedItem {
  title: string;
  year?: number | null;
}

export interface ImportBatchResponse {
  importedCount: number;
  unmatchedCount: number;
  unmatched: ImportUnmatchedItem[];
}
