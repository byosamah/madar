/**
 * The rule for a reaction (chat presence design E5, base B1): one emoji, as the device draws it. A plain file with no zod, so a screen
 * of the first load can read it. The list of emoji for the panel is not here; the panel loads it on the first open.
 */
import { REACTIONS } from './limits';

/** The most different emoji on one message or comment. */
export const MAX_REACTION_KINDS = 20;

/** The most UTF-16 units of one reaction. A flag of a region with tag letters is the longest standard one (14). */
const MAX_REACTION_UNITS = 32;

/**
 * One emoji: a picture with its tone and its joins, two regional indicators (a flag), a flag with tag letters, or a keycap. The `u`
 * flag only: the `v` flag fails on older Safari.
 */
const EMOJI =
  /^(?:\p{Extended_Pictographic}[️\p{Emoji_Modifier}]?(?:‍\p{Extended_Pictographic}[️\p{Emoji_Modifier}]?)*(?:[\u{E0020}-\u{E007E}]+\u{E007F})?|\p{Regional_Indicator}{2}|[#*0-9]️?⃣)$/u;

/**
 * The grapheme segmenter, built on the first check and not at module load: `new Intl.Segmenter` costs about 10 ms, and the server
 * paid it in every cold start (performance audit SV-2). `undefined` means not built yet; `null` means the runtime has no Segmenter.
 */
let segmenter: Intl.Segmenter | null | undefined;

/** True when the value is exactly one emoji of 1 to 32 UTF-16 units. */
export function isReactionEmoji(value: string): boolean {
  if (value.length === 0 || value.length > MAX_REACTION_UNITS) return false;
  segmenter ??= typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  if (segmenter) {
    const parts = [...segmenter.segment(value)];
    if (parts.length !== 1) return false;
  }
  return EMOJI.test(value);
}

const codePointsOf = (value: string): number[] => [...value].map((char) => char.codePointAt(0) ?? 0);

/** Compares two chains of code points, item by item. */
function compareCodePoints(a: string, b: string): number {
  const left = codePointsOf(a);
  const right = codePointsOf(b);
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}

/** The order of the pills: the three quick ones first, in their order, then the others by code points. It needs no stored order. */
export function orderReactions(keys: readonly string[]): string[] {
  const quick = (REACTIONS as readonly string[]).filter((emoji) => keys.includes(emoji));
  const rest = keys.filter((key) => !(REACTIONS as readonly string[]).includes(key)).sort(compareCodePoints);
  return [...quick, ...rest];
}
