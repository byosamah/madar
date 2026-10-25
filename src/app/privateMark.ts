/**
 * The one class that hides a private part (insight design, section 5, rule 1). PostHog leaves such a part out of the click records,
 * and the replay draws a gray box of the same size in its place. It records no text and no attribute inside the part.
 * Put it on the smallest element that holds a chat message, an amount, or a file picture or link.
 * `privateMark.test.ts` fails when a file that makes a file link has no mark.
 */
export const PRIVATE = 'ph-no-capture';
