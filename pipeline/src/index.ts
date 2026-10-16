import { MOODS } from '@tonight/shared';

export function getCanonicalMoodIds(): string[] {
  return MOODS.map((m) => m.id);
}
