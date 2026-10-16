export const REACTIONS = ['loved', 'liked', 'meh', 'disliked'] as const;

export const TRACK_STATUSES = ['watchlist', 'watched'] as const;

export const VISIBILITIES = ['public', 'friends', 'private'] as const;

export const REC_FEEDBACK_KINDS = ['not_interested', 'more_like_this', 'not_tonight'] as const;

export const IMPORT_SOURCES = ['letterboxd', 'imdb'] as const;

export const MOVIE_SOURCES = ['wikidata', 'tmdb_stub'] as const;

export const ANCHOR_WEIGHTS = {
  favourite: 1.5,
  loved: 1.0,
  liked: 0.6,
  watchlist: 0.25,
  more_like_this: 0.8,
  meh: -0.3,
  disliked: -1.0,
  not_interested: -0.6,
} as const;

export const SCORING_WEIGHTS = {
  story: 0.7,
  structure: 0.15,
  people: 0.08,
  negative: 0.6,
  popularity: 0.2,
} as const;

export const STORY_SOFTMAX_TEMP = 0.05;
export const NEGATIVE_SIM_THRESHOLD = 0.72;
export const DEFAULT_DISCOVERY_DIAL = 0.4;
export const MMR_LAMBDA_DEFAULT = 0.72;
export const MMR_LAMBDA_TONIGHT = 0.6;
export const MAX_USER_ANCHORS = 40;
export const RECENCY_DECAY_BASE = 0.8;
export const RECENCY_DECAY_FLOOR = 0.4;
export const SECONDS_PER_YEAR = 31_557_600;

export const MMR_CAPS_DEFAULT = {
  maxPerSeries: 1,
  maxPerDirector: 2,
} as const;

export const QUALITY_FLOOR = {
  minImdbRating: 6.0,
  minImdbVotes: 300,
  minAnchorSimOverride: 0.84,
} as const;

export const DEFAULT_REGION = 'IN';

export interface MoodDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly sort: number;
}

export const MOODS: readonly MoodDefinition[] = [
  {
    id: 'mind-bending',
    label: 'Mind-bending',
    description:
      'Genres: science fiction, thriller, mystery. Themes: time loop, parallel universe, unreliable narrator, memory manipulation, existential puzzle, reality distortion. Plot: A protagonist questions the nature of reality as hidden layers of truth unravel in a twist-filled narrative.',
    sort: 1,
  },
  {
    id: 'feel-good',
    label: 'Feel-good',
    description:
      'Genres: comedy, drama, family. Themes: friendship, optimism, self-discovery, community, triumph, warmth, kindness. Plot: Characters overcome personal hurdles through connection, humor, and heart, leading to an uplifting resolution.',
    sort: 2,
  },
  {
    id: 'dark-gritty',
    label: 'Dark & gritty',
    description:
      'Genres: crime, neo-noir, thriller, drama. Themes: corruption, vengeance, moral ambiguity, survival, urban decay, desperation. Plot: In a harsh, unforgiving world, flawed characters make grim choices with irreversible consequences.',
    sort: 3,
  },
  {
    id: 'edge-of-seat',
    label: 'Edge-of-seat',
    description:
      'Genres: thriller, action, suspense. Themes: race against time, survival, heist, pursuit, high stakes, conspiracy, hostage. Plot: Relentless tension and escalating danger force the protagonist to outwit a formidable threat before time runs out.',
    sort: 4,
  },
  {
    id: 'cozy',
    label: 'Cozy & gentle',
    description:
      'Genres: slice of life, comedy, romance. Themes: small town, cooking, nature, everyday magic, gentle humor, comfort, nostalgia. Plot: A low-stakes, intimate story about ordinary days, warm relationships, and quiet joys.',
    sort: 5,
  },
  {
    id: 'tearjerker',
    label: 'Tearjerker',
    description:
      'Genres: drama, romance. Themes: grief, terminal illness, sacrifice, bittersweet love, family separation, memory, loss. Plot: A deeply emotional journey of love, loss, and resilience that leaves a lasting cathartic impact.',
    sort: 6,
  },
  {
    id: 'epic',
    label: 'Epic journey',
    description:
      'Genres: adventure, fantasy, historical, science fiction. Themes: quest, rebellion, empire, odyssey, destiny, world-building, war. Plot: Across vast landscapes and eras, heroes embark on a perilous journey that reshapes their world.',
    sort: 7,
  },
  {
    id: 'quiet-slow',
    label: 'Quiet & slow',
    description:
      'Genres: arthouse, drama. Themes: solitude, contemplation, memory, passage of time, alienation, atmospheric minimalism. Plot: An observational, meditative portrait of inner life told through lingering moments and subtle emotion.',
    sort: 8,
  },
] as const;

export type MoodId = (typeof MOODS)[number]['id'];
