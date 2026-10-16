import { MOODS, type MoodDefinition } from '@tonight/shared';
import { embedText, type TextEmbedderFn } from './embed';

export interface EmbeddedMoodRow extends MoodDefinition {
  readonly embedding: number[];
}

/**
 * Embeds the 8 canonical moods from `@tonight/shared` using `Supabase/gte-small`.
 */
export async function embedCanonicalMoods(
  embedFn: TextEmbedderFn = embedText,
): Promise<EmbeddedMoodRow[]> {
  const results: EmbeddedMoodRow[] = [];

  for (const mood of MOODS) {
    const embedding = await embedFn(mood.description);
    results.push({
      id: mood.id,
      label: mood.label,
      description: mood.description,
      sort: mood.sort,
      embedding: [...embedding],
    });
  }

  return results;
}
