export const HUES = ['blue', 'orange', 'green', 'purple', 'pink', 'teal', 'amber', 'indigo'] as const;
export type Hue = (typeof HUES)[number];

/** One soft hue per project, for life: a stable hash of its id (redesign spec 2.3). */
export function projectHue(id: string): Hue {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return HUES[hash % HUES.length];
}

/** The Arabic article "ال" says nothing about a name, so the tile skips it ("مجمع النخلة" gives "من"). */
const withoutArticle = (word: string) => (word.startsWith('ال') && [...word].length > 3 ? word.slice(2) : word);

/** Two letters for the project tile: the first letters of the first two words, or the first two letters of one word. */
export function projectInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean).map(withoutArticle);
  if (words.length === 0) return '?';
  const letters = words.length === 1 ? [...words[0]].slice(0, 2) : [[...words[0]][0], [...words[1]][0]];
  return letters.join('').toUpperCase();
}

/** The progress line (redesign spec 2.4): (current stage index + 1) / (stage count + 1); a completed project is full. */
export function stageProgress(summary: { stages: { id: string }[]; currentStage: { id: string }; project: { status: string } }): number {
  if (summary.project.status === 'completed') return 1;
  const index = Math.max(0, summary.stages.findIndex((stage) => stage.id === summary.currentStage.id));
  return (index + 1) / (summary.stages.length + 1);
}
