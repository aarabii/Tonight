export interface SeedPersonCredit {
  readonly wikidataQid: string;
  readonly tmdbPersonId: number;
  readonly name: string;
  readonly role: 'director' | 'cast' | 'writer' | 'composer';
  readonly billing?: number;
}

export interface SeedFilmDefinition {
  readonly wikidataQid: string;
  readonly tmdbId: number;
  readonly imdbId: string;
  readonly title: string;
  readonly originalTitle?: string;
  readonly year: number;
  readonly runtimeMin: number;
  readonly genres: readonly string[];
  readonly subjects: readonly string[];
  readonly settings: readonly string[];
  readonly languages: readonly string[];
  readonly countries: readonly string[];
  readonly seriesQid?: string | null;
  readonly sitelinks: number;
  readonly imdbRating: number;
  readonly imdbVotes: number;
  readonly enwikiTitle: string;
  readonly plot: string;
  readonly credits: readonly SeedPersonCredit[];
}
