import { describe, expect, it } from 'vitest';
import { MOODS, SCORING_WEIGHTS } from '@tonight/shared';
import { getCanonicalMoodIds } from '../index';

describe('pipeline smoke test', () => {
  it('imports @tonight/shared constants and mood definitions', () => {
    expect(getCanonicalMoodIds()).toHaveLength(8);
    expect(MOODS[0]?.id).toBe('mind-bending');
    expect(SCORING_WEIGHTS.story).toBe(0.7);
  });
});
