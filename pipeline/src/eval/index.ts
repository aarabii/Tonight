import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import {
  buildSeedCatalog,
  SEED_EMBEDDED_FIXTURE_PATH,
  type EmbeddedSeedCatalogFixture,
} from '../build-seed';
import { evaluateDialSensitivity, type DialEvalReport } from './dial';
import { evaluateLeaveOneOut, type LooEvalReport } from './loo';
import { evaluateSanityPairs, type SanityEvalReport } from './sanity-pairs';

export interface FullEvalSummary {
  readonly catalogSize: number;
  readonly sanity: SanityEvalReport;
  readonly loo: LooEvalReport;
  readonly dial: DialEvalReport;
  readonly allPassed: boolean;
}

export async function loadOrBuildEmbeddedFixture(): Promise<EmbeddedSeedCatalogFixture> {
  if (existsSync(SEED_EMBEDDED_FIXTURE_PATH)) {
    const raw = await readFile(SEED_EMBEDDED_FIXTURE_PATH, 'utf-8');
    return JSON.parse(raw) as EmbeddedSeedCatalogFixture;
  }
  return buildSeedCatalog();
}

export async function runOfflineEvaluation(
  fixtureOverride?: EmbeddedSeedCatalogFixture,
): Promise<FullEvalSummary> {
  const fixture = fixtureOverride ?? (await loadOrBuildEmbeddedFixture());
  const movies = fixture.movies;

  const sanity = evaluateSanityPairs(movies);
  const loo = evaluateLeaveOneOut(movies);
  const dial = evaluateDialSensitivity(movies);

  const allPassed = sanity.passed && loo.passed && dial.passed;

  return {
    catalogSize: movies.length,
    sanity,
    loo,
    dial,
    allPassed,
  };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

if (import.meta.main) {
  runOfflineEvaluation()
    .then((summary) => {
      console.log('================================================================');
      console.log(`TONIGHT OFFLINE RECOMMENDATION EVALUATION (Catalog: ${summary.catalogSize} films)`);
      console.log('================================================================\n');

      // 1. Sanity Pairs
      console.log('1. Sanity Pair Suite');
      console.log(
        `   Positive pairs (sim >= 0.74 & top-50): ${summary.sanity.positivePassCount}/${summary.sanity.positiveTotal} (${pct(summary.sanity.positivePassRate)}) [Threshold: >= 90.0%]`,
      );
      for (const pos of summary.sanity.positiveResults) {
        if (!pos.passed) {
          console.log(
            `     [FAIL] ${pos.pair.id}: ${pos.pair.movieATitle} <-> ${pos.pair.movieBTitle} | sim=${pos.similarity.toFixed(4)} | ranks=(${pos.rankBinA}, ${pos.rankAinB})`,
          );
        }
      }
      console.log(
        `   Negative pairs (sim < 0.60):          ${summary.sanity.negativePassCount}/${summary.sanity.negativeTotal} (${pct(summary.sanity.negativePassRate)}) [Threshold: 100.0%]`,
      );
      for (const neg of summary.sanity.negativeResults) {
        if (!neg.passed) {
          console.log(
            `     [FAIL] ${neg.pair.id}: ${neg.pair.movieATitle} -/-> ${neg.pair.movieBTitle} | sim=${neg.similarity.toFixed(4)}`,
          );
        }
      }
      console.log(`   Status: ${summary.sanity.passed ? 'PASS' : 'FAIL'}\n`);

      // 2. Leave-One-Out
      console.log(`2. Leave-One-Out Benchmark (${summary.loo.profileCount} profiles, ${summary.loo.totalTrials} holdout trials)`);
      console.log(
        `   Tonight Scorer:        Hit@20 = ${pct(summary.loo.tonight.hitAt20)} (${summary.loo.tonight.hits}/${summary.loo.tonight.totalTrials}) | nDCG@20 = ${summary.loo.tonight.ndcgAt20.toFixed(4)}`,
      );
      console.log(
        `   Genre Popularity:      Hit@20 = ${pct(summary.loo.genrePopularity.hitAt20)} (${summary.loo.genrePopularity.hits}/${summary.loo.genrePopularity.totalTrials}) | nDCG@20 = ${summary.loo.genrePopularity.ndcgAt20.toFixed(4)}`,
      );
      console.log(
        `   Single Mean Vector:    Hit@20 = ${pct(summary.loo.singleMeanVector.hitAt20)} (${summary.loo.singleMeanVector.hits}/${summary.loo.singleMeanVector.totalTrials}) | nDCG@20 = ${summary.loo.singleMeanVector.ndcgAt20.toFixed(4)}`,
      );
      console.log(
        `   Relative Lift vs Genre Popularity:   +${pct(summary.loo.relativeLiftVsGenrePop)} [Threshold: >= +15.0%]`,
      );
      console.log(
        `   Relative Lift vs Single Mean Vector: +${pct(summary.loo.relativeLiftVsSingleMean)} [Threshold: >= +15.0%]`,
      );
      console.log(`   Status: ${summary.loo.passed ? 'PASS' : 'FAIL'}\n`);

      // 3. Discovery Dial Sensitivity
      console.log('3. Discovery Dial Sensitivity');
      console.log(
        `   Mean top-20 popularity_pct @ dial=0.0 (Crowd):   ${summary.dial.meanPopularityDial0.toFixed(4)}`,
      );
      console.log(
        `   Mean top-20 popularity_pct @ dial=0.4 (Default): ${summary.dial.meanPopularityDialDefault.toFixed(4)}`,
      );
      console.log(
        `   Mean top-20 popularity_pct @ dial=1.0 (Gems):    ${summary.dial.meanPopularityDial1.toFixed(4)}`,
      );
      console.log(
        `   Popularity shift (dial 0.0 -> 1.0):              ${summary.dial.popularityShift.toFixed(4)} [Threshold: >= 0.2500]`,
      );
      console.log(`   Status: ${summary.dial.passed ? 'PASS' : 'FAIL'}\n`);

      console.log('================================================================');
      console.log(`OVERALL EVAL STATUS: ${summary.allPassed ? 'PASS ✅' : 'FAIL ❌'}`);
      console.log('================================================================');

      if (!summary.allPassed) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('[eval] Fatal error:', err);
      process.exit(1);
    });
}
