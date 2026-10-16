import type { EmbeddedSeedMovie } from '../build-seed';
import { cosineSimilarity } from '../embed';

export interface SanityPair {
  readonly id: string;
  readonly movieATitle: string;
  readonly movieBTitle: string;
  readonly rationale: string;
}

export interface PositivePairEvalResult {
  readonly pair: SanityPair;
  readonly similarity: number;
  readonly rankBinA: number;
  readonly rankAinB: number;
  readonly passed: boolean;
}

export interface NegativePairEvalResult {
  readonly pair: SanityPair;
  readonly similarity: number;
  readonly passed: boolean;
}

export interface SanityEvalReport {
  readonly positiveResults: readonly PositivePairEvalResult[];
  readonly negativeResults: readonly NegativePairEvalResult[];
  readonly positivePassCount: number;
  readonly positiveTotal: number;
  readonly positivePassRate: number;
  readonly negativePassCount: number;
  readonly negativeTotal: number;
  readonly negativePassRate: number;
  readonly passed: boolean;
}

/**
 * 40 curated positive story pairs: films whose core plots, narrative conflicts,
 * themes, and settings share deep structural Story DNA.
 */
export const POSITIVE_SANITY_PAIRS: readonly SanityPair[] = [
  {
    id: 'pos-01',
    movieATitle: 'Arrival',
    movieBTitle: 'Contact',
    rationale: 'Scientists decode extraterrestrial transmissions while grappling with personal loss and time.',
  },
  {
    id: 'pos-02',
    movieATitle: 'Memento',
    movieBTitle: 'The Prestige',
    rationale: 'Obsessive revenge, fractured identity, deception, and non-linear puzzle narratives.',
  },
  {
    id: 'pos-03',
    movieATitle: 'Drishyam',
    movieBTitle: 'Prisoners',
    rationale: 'Fathers cross moral and legal boundaries to protect their families during a desperate police investigation.',
  },
  {
    id: 'pos-04',
    movieATitle: 'Before Sunrise',
    movieBTitle: 'Lost in Translation',
    rationale: 'Two strangers in a foreign city share a fleeting, deeply intimate romantic connection over conversations.',
  },
  {
    id: 'pos-05',
    movieATitle: 'The Raid',
    movieBTitle: 'Dredd',
    rationale: 'Law enforcement officers trapped inside a sealed high-rise tower controlled by a ruthless crime lord.',
  },
  {
    id: 'pos-06',
    movieATitle: 'Inception',
    movieBTitle: 'Paprika',
    rationale: 'Subconscious dream infiltration using experimental technology blurs waking reality and dreams.',
  },
  {
    id: 'pos-07',
    movieATitle: 'Black Swan',
    movieBTitle: 'Perfect Blue',
    rationale: 'A young performer consumed by artistic perfection suffers fracturing identity, paranoia, and hallucinations.',
  },
  {
    id: 'pos-08',
    movieATitle: 'Groundhog Day',
    movieBTitle: 'Palm Springs',
    rationale: 'Cynical protagonists trapped in an endless 24-hour time loop learn connection and self-transformation.',
  },
  {
    id: 'pos-09',
    movieATitle: 'Edge of Tomorrow',
    movieBTitle: 'Source Code',
    rationale: 'Soldiers repeatedly relive a lethal combat timeline to uncover the enemy threat and prevent catastrophe.',
  },
  {
    id: 'pos-10',
    movieATitle: 'Interstellar',
    movieBTitle: 'Ad Astra',
    rationale: 'Astronauts embark on deep-space missions across the cosmos driven by fractured father-child bonds.',
  },
  {
    id: 'pos-11',
    movieATitle: 'Blade Runner',
    movieBTitle: 'Ex Machina',
    rationale: 'Android consciousness, empathy tests, and what defines humanity between synthetic beings and their creators.',
  },
  {
    id: 'pos-12',
    movieATitle: 'Her',
    movieBTitle: 'Eternal Sunshine of the Spotless Mind',
    rationale: 'Lonely introverts navigate modern heartbreak, memory, and technology-mediated romantic intimacy.',
  },
  {
    id: 'pos-13',
    movieATitle: 'Se7en',
    movieBTitle: 'Zodiac',
    rationale: 'Detectives obsessively pursue a ritualistic serial killer through rain-soaked urban darkness.',
  },
  {
    id: 'pos-14',
    movieATitle: 'Memories of Murder',
    movieBTitle: 'The Silence of the Lambs',
    rationale: 'Investigators profile an elusive serial murderer in small-town darkness as psychological toll mounts.',
  },
  {
    id: 'pos-15',
    movieATitle: 'Parasite',
    movieBTitle: 'Shoplifters',
    rationale: 'Impoverished families survive through clever grifting and deception across stark social class divides.',
  },
  {
    id: 'pos-16',
    movieATitle: 'Whiplash',
    movieBTitle: 'Tár',
    rationale: 'Ruthless musical obsession, power abuse, and psychological warfare between maestro and protégé.',
  },
  {
    id: 'pos-17',
    movieATitle: 'Heat',
    movieBTitle: 'The Town',
    rationale: 'Professional bank heist crews plan one final score while hunted by a relentless detective.',
  },
  {
    id: 'pos-18',
    movieATitle: 'Infernal Affairs',
    movieBTitle: 'The Departed',
    rationale: 'An undercover cop inside a crime syndicate and a syndicate mole inside the police race to expose each other.',
  },
  {
    id: 'pos-19',
    movieATitle: 'Goodfellas',
    movieBTitle: 'Gangs of Wasseypur',
    rationale: 'Multi-decade crime sagas charting the violent rise, loyalty, and betrayal of mafia clans.',
  },
  {
    id: 'pos-20',
    movieATitle: 'Oldboy',
    movieBTitle: 'Incendies',
    rationale: 'A relentless search into the past uncovers a devastating family secret and tragedy.',
  },
  {
    id: 'pos-21',
    movieATitle: 'Spirited Away',
    movieBTitle: 'Pan\'s Labyrinth',
    rationale: 'A young girl enters a perilous mythic underworld populated by spirits and monsters to save her family.',
  },
  {
    id: 'pos-22',
    movieATitle: 'The Shawshank Redemption',
    movieBTitle: 'Escape from Alcatraz',
    rationale: 'Imprisoned men endure brutal penitentiary life while patiently engineering an ingenious prison escape.',
  },
  {
    id: 'pos-23',
    movieATitle: 'Spotlight',
    movieBTitle: 'All the President\'s Men',
    rationale: 'Investigative journalists methodically uncover a massive institutional cover-up through shoe-leather reporting.',
  },
  {
    id: 'pos-24',
    movieATitle: '12 Angry Men',
    movieBTitle: 'Court',
    rationale: 'Legal dramas exposing systemic prejudice, bias, and the fragility of justice inside the courtroom.',
  },
  {
    id: 'pos-25',
    movieATitle: 'In the Mood for Love',
    movieBTitle: 'Brief Encounter',
    rationale: 'Unspoken longing and restrained, bittersweet romance between two married people who cannot be together.',
  },
  {
    id: 'pos-26',
    movieATitle: 'Portrait of a Lady on Fire',
    movieBTitle: 'Carol',
    rationale: 'Forbidden love and artistic gaze blossom between two women bound by rigid societal conventions.',
  },
  {
    id: 'pos-27',
    movieATitle: 'The Truman Show',
    movieBTitle: 'The Matrix',
    rationale: 'An ordinary man discovers his entire world is a constructed simulation controlled by unseen architects.',
  },
  {
    id: 'pos-28',
    movieATitle: 'Children of Men',
    movieBTitle: 'Logan',
    rationale: 'A weary, cynical protector escorts a miraculous young girl across a collapsing dystopian wasteland.',
  },
  {
    id: 'pos-29',
    movieATitle: 'Alien',
    movieBTitle: 'The Thing',
    rationale: 'An isolated crew in a claustrophobic outpost is hunted from within by a lethal extraterrestrial organism.',
  },
  {
    id: 'pos-30',
    movieATitle: 'Hereditary',
    movieBTitle: 'The Witch',
    rationale: 'A grieving isolated family unravels under sinister occult forces and generational curses.',
  },
  {
    id: 'pos-31',
    movieATitle: 'Get Out',
    movieBTitle: 'Rosemary\'s Baby',
    rationale: 'A protagonist slowly realizes their welcoming hosts and inner circle are plotting a body-snatching conspiracy.',
  },
  {
    id: 'pos-32',
    movieATitle: 'Knives Out',
    movieBTitle: 'Gosford Park',
    rationale: 'An eccentric detective investigates the murder of a wealthy patriarch inside a country manor full of scheming heirs.',
  },
  {
    id: 'pos-33',
    movieATitle: 'Andhadhun',
    movieBTitle: 'Fargo',
    rationale: 'Darkly comic crime thrillers where a deceptive scheme spirals into compounding murders and absurd cover-ups.',
  },
  {
    id: 'pos-34',
    movieATitle: 'The Lunchbox',
    movieBTitle: 'You\'ve Got Mail',
    rationale: 'Two lonely city dwellers fall in love through anonymous written correspondence before knowing each other\'s identity.',
  },
  {
    id: 'pos-35',
    movieATitle: '3 Idiots',
    movieBTitle: 'Dead Poets Society',
    rationale: 'Students at an elite academy rebel against rigid academic pressure to pursue authentic passion and friendship.',
  },
  {
    id: 'pos-36',
    movieATitle: 'Taare Zameen Par',
    movieBTitle: 'Good Will Hunting',
    rationale: 'A compassionate mentor helps a misunderstood, struggling young mind overcome trauma and realize his gift.',
  },
  {
    id: 'pos-37',
    movieATitle: 'Tumbbad',
    movieBTitle: 'There Will Be Blood',
    rationale: 'Decades-spanning cautionary tales of a man consumed by bottomless greed and obsession that destroys his family.',
  },
  {
    id: 'pos-38',
    movieATitle: 'Die Hard',
    movieBTitle: 'Kaithi',
    rationale: 'A lone bruised hero battles an army of heavily armed criminals through a single fateful night to reunite with his child.',
  },
  {
    id: 'pos-39',
    movieATitle: 'Manchester by the Sea',
    movieBTitle: 'Ordinary People',
    rationale: 'Quiet, devastating family dramas about guilt, grief, and emotional numbness after a family tragedy.',
  },
  {
    id: 'pos-40',
    movieATitle: 'Superbad',
    movieBTitle: 'Booksmart',
    rationale: 'Two inseparable best friends on the eve of high school graduation embark on one chaotic night of party-hopping.',
  },
] as const;

/**
 * 15 curated negative story pairs: films whose plots, tone, setting, and themes are
 * fundamentally incompatible and must never score as story neighbours (`sim < 0.60`).
 */
export const NEGATIVE_SANITY_PAIRS: readonly SanityPair[] = [
  {
    id: 'neg-01',
    movieATitle: 'Toy Story',
    movieBTitle: 'Saw',
    rationale: 'Playful childhood animated friendship vs sadistic torture-trap horror.',
  },
  {
    id: 'neg-02',
    movieATitle: 'My Neighbor Totoro',
    movieBTitle: 'Se7en',
    rationale: 'Gentle pastoral childhood wonder vs nihilistic serial-killer noir.',
  },
  {
    id: 'neg-03',
    movieATitle: 'Before Sunrise',
    movieBTitle: 'The Raid',
    rationale: 'Quiet walk-and-talk European romance vs non-stop tactical martial-arts siege.',
  },
  {
    id: 'neg-04',
    movieATitle: 'Paddington 2',
    movieBTitle: 'Hereditary',
    rationale: 'Warm family marmalade comedy vs occult family trauma horror.',
  },
  {
    id: 'neg-05',
    movieATitle: 'Superbad',
    movieBTitle: 'Schindler\'s List',
    rationale: 'Teen party slapstick comedy vs Holocaust historical tragedy.',
  },
  {
    id: 'neg-06',
    movieATitle: 'The Lunchbox',
    movieBTitle: 'Mad Max: Fury Road',
    rationale: 'Quiet epistolary Mumbai romance vs post-apocalyptic desert vehicular warfare.',
  },
  {
    id: 'neg-07',
    movieATitle: 'Amélie',
    movieBTitle: 'The Thing',
    rationale: 'Whimsical Parisian matchmaking vs paranoid Antarctic alien body-horror.',
  },
  {
    id: 'neg-08',
    movieATitle: 'Booksmart',
    movieBTitle: 'There Will Be Blood',
    rationale: 'High school graduation comedy vs turn-of-the-century ruthless oil baron tragedy.',
  },
  {
    id: 'neg-09',
    movieATitle: 'Ratatouille',
    movieBTitle: 'Zodiac',
    rationale: 'Uplifting Parisian culinary animation vs obsessive unsolved serial murder investigation.',
  },
  {
    id: 'neg-10',
    movieATitle: 'Singin\' in the Rain',
    movieBTitle: 'Prisoners',
    rationale: 'Joyful Hollywood musical comedy vs agonizing child-abduction thriller.',
  },
  {
    id: 'neg-11',
    movieATitle: 'Kiki\'s Delivery Service',
    movieBTitle: 'Oldboy',
    rationale: 'Cozy coming-of-age coastal bakery story vs brutal captivity and psychological vengeance.',
  },
  {
    id: 'neg-12',
    movieATitle: 'Finding Nemo',
    movieBTitle: 'The Silence of the Lambs',
    rationale: 'Colorful ocean family adventure vs FBI profiling of cannibalistic serial killers.',
  },
  {
    id: 'neg-13',
    movieATitle: '3 Idiots',
    movieBTitle: 'Alien',
    rationale: 'Warm college friendship comedy-drama vs claustrophobic deep-space xenomorph horror.',
  },
  {
    id: 'neg-14',
    movieATitle: 'Paterson',
    movieBTitle: 'Dredd',
    rationale: 'Quiet poetic routine of a small-town bus driver vs hyper-violent dystopian megacity lockdown.',
  },
  {
    id: 'neg-15',
    movieATitle: 'Little Women',
    movieBTitle: 'The Matrix',
    rationale: '19th-century New England sisterhood domestic drama vs cyberpunk machine simulation warfare.',
  },
] as const;

export const POSITIVE_MIN_SIMILARITY = 0.74;
export const POSITIVE_MAX_RANK = 50;
export const POSITIVE_PASS_RATE_THRESHOLD = 0.9;
export const NEGATIVE_MAX_SIMILARITY = 0.6;
export const NEGATIVE_PASS_RATE_THRESHOLD = 1.0;

/**
 * Evaluates all 40 positive and 15 negative sanity pairs against the embedded catalog.
 * - Positive pair pass criteria: `sim >= 0.74` AND A is in B's top 50 AND B is in A's top 50.
 *   Suite passes when `>= 90%` of positive pairs pass.
 * - Negative pair pass criteria: `sim < 0.60`.
 *   Suite passes when `100%` of negative pairs pass.
 */
export function evaluateSanityPairs(movies: readonly EmbeddedSeedMovie[]): SanityEvalReport {
  const byTitle = new Map<string, EmbeddedSeedMovie>();
  for (const m of movies) {
    byTitle.set(m.title.toLowerCase(), m);
  }

  // Precompute pairwise cosine similarity rankings per film
  const rankMap = new Map<number, Map<number, number>>();
  for (const anchor of movies) {
    const neighbours = movies
      .filter((other) => other.id !== anchor.id)
      .map((other) => ({
        id: other.id,
        sim: cosineSimilarity(anchor.embedding, other.embedding),
      }))
      .sort((a, b) => b.sim - a.sim);

    const ranks = new Map<number, number>();
    neighbours.forEach((n, idx) => {
      ranks.set(n.id, idx + 1);
    });
    rankMap.set(anchor.id, ranks);
  }

  const positiveResults: PositivePairEvalResult[] = [];
  for (const pair of POSITIVE_SANITY_PAIRS) {
    const movieA = byTitle.get(pair.movieATitle.toLowerCase());
    const movieB = byTitle.get(pair.movieBTitle.toLowerCase());
    if (!movieA || !movieB) {
      throw new Error(
        `Sanity pair ${pair.id} missing movie in catalog: "${pair.movieATitle}" or "${pair.movieBTitle}"`,
      );
    }

    const similarity = cosineSimilarity(movieA.embedding, movieB.embedding);
    const rankBinA = rankMap.get(movieA.id)?.get(movieB.id) ?? Infinity;
    const rankAinB = rankMap.get(movieB.id)?.get(movieA.id) ?? Infinity;
    const passed =
      similarity >= POSITIVE_MIN_SIMILARITY &&
      rankBinA <= POSITIVE_MAX_RANK &&
      rankAinB <= POSITIVE_MAX_RANK;

    positiveResults.push({
      pair,
      similarity,
      rankBinA,
      rankAinB,
      passed,
    });
  }

  const negativeResults: NegativePairEvalResult[] = [];
  for (const pair of NEGATIVE_SANITY_PAIRS) {
    const movieA = byTitle.get(pair.movieATitle.toLowerCase());
    const movieB = byTitle.get(pair.movieBTitle.toLowerCase());
    if (!movieA || !movieB) {
      throw new Error(
        `Sanity negative pair ${pair.id} missing movie in catalog: "${pair.movieATitle}" or "${pair.movieBTitle}"`,
      );
    }

    const similarity = cosineSimilarity(movieA.embedding, movieB.embedding);
    const passed = similarity < NEGATIVE_MAX_SIMILARITY;
    negativeResults.push({
      pair,
      similarity,
      passed,
    });
  }

  const positivePassCount = positiveResults.filter((r) => r.passed).length;
  const positiveTotal = positiveResults.length;
  const positivePassRate = positiveTotal > 0 ? positivePassCount / positiveTotal : 0;

  const negativePassCount = negativeResults.filter((r) => r.passed).length;
  const negativeTotal = negativeResults.length;
  const negativePassRate = negativeTotal > 0 ? negativePassCount / negativeTotal : 0;

  const passed =
    positivePassRate >= POSITIVE_PASS_RATE_THRESHOLD &&
    negativePassRate >= NEGATIVE_PASS_RATE_THRESHOLD;

  return {
    positiveResults,
    negativeResults,
    positivePassCount,
    positiveTotal,
    positivePassRate,
    negativePassCount,
    negativeTotal,
    negativePassRate,
    passed,
  };
}

