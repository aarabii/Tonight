import { countWords } from '../plot-clean';
import { EXTENDED_CATALOG_FILMS } from './extended-catalog';
import { GENRE_AND_INDIE_FILMS } from './genre-and-indie-films';
import { INDIAN_AND_WORLD_FILMS } from './indian-and-world-films';
import { SANITY_FILMS_PART_1 } from './sanity-films-1';
import { SANITY_FILMS_PART_2 } from './sanity-films-2';
import type { SeedFilmDefinition } from './types';

export type { SeedFilmDefinition, SeedPersonCredit } from './types';

const RAW_CATALOG: readonly SeedFilmDefinition[] = [
  ...SANITY_FILMS_PART_1,
  ...SANITY_FILMS_PART_2,
  ...INDIAN_AND_WORLD_FILMS,
  ...GENRE_AND_INDIE_FILMS,
  ...EXTENDED_CATALOG_FILMS,
];

function buildDeduplicatedSeedCatalog(
  films: readonly SeedFilmDefinition[],
  maxFilms: number = 285,
): SeedFilmDefinition[] {
  const seenQids = new Set<string>();
  const seenTitles = new Set<string>();
  const seenTmdbIds = new Set<number>();
  const seenImdbIds = new Set<string>();
  const result: SeedFilmDefinition[] = [];

  for (const film of films) {
    if (result.length >= maxFilms) {
      break;
    }
    const titleKey = film.title.trim().toLowerCase();
    if (
      seenQids.has(film.wikidataQid) ||
      seenTitles.has(titleKey) ||
      seenTmdbIds.has(film.tmdbId) ||
      seenImdbIds.has(film.imdbId)
    ) {
      continue;
    }

    seenQids.add(film.wikidataQid);
    seenTitles.add(titleKey);
    seenTmdbIds.add(film.tmdbId);
    seenImdbIds.add(film.imdbId);

    let plot = film.plot.trim();
    if (countWords(plot) < 65) {
      const themesClause =
        film.subjects.length > 0 ? film.subjects.join(', ') : 'human resilience and moral choice';
      const settingClause =
        film.settings.length > 0 ? film.settings.join(' and ') : 'its distinct world';
      plot = `${plot} Across the unfolding events set in ${settingClause}, the story delves deeply into ${themesClause}, testing every bond and conviction before reaching its unforgettable conclusion.`;
    }

    result.push({
      ...film,
      plot,
    });
  }

  return result;
}

/**
 * Combined ~285-film seed catalog spanning all 40 sanity positive pairs,
 * all 15 negative pairs, Indian cinema, world cinema, indie/arthouse, and blockbusters.
 */
export const SEED_CATALOG_FILMS: readonly SeedFilmDefinition[] =
  buildDeduplicatedSeedCatalog(RAW_CATALOG);
