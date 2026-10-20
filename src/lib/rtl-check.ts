// Finds physical left and right styles. The app uses logical start and end styles, so Arabic mirrors correctly.
const RULES: { rule: string; pattern: RegExp }[] = [
  {
    rule: 'Tailwind physical class',
    pattern:
      /(?<![\w-])-?(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-[\w[\].\/%-]+/g,
  },
  { rule: 'Tailwind physical class', pattern: /(?<![\w-])(?:text|float|clear)-(?:left|right)(?![\w-])/g },
  { rule: 'Tailwind physical class', pattern: /(?<![\w-])border-[lr](?![\w-])/g },
  { rule: 'CSS physical property', pattern: /(?<![\w-])(?:margin|padding|border)-(?:left|right)(?:-[a-z]+)?\s*:/g },
  { rule: 'CSS physical property', pattern: /(?<![\w-])(?:left|right)\s*:\s*[-\d.]/g },
  { rule: 'CSS physical value', pattern: /(?:text-align|float|clear)\s*:\s*(?:left|right)\b/g },
  { rule: 'JS physical style', pattern: /(?<![\w-])(?:marginLeft|marginRight|paddingLeft|paddingRight|borderLeft|borderRight)\b/g },
];

export type RtlFinding = { line: number; rule: string; match: string };

export function findPhysicalDirection(source: string): RtlFinding[] {
  const findings: RtlFinding[] = [];
  source.split('\n').forEach((text, index) => {
    if (text.includes('rtl-ok')) return;
    for (const { rule, pattern } of RULES) {
      for (const match of text.matchAll(pattern)) findings.push({ line: index + 1, rule, match: match[0] });
    }
  });
  return findings;
}

/** The index of the ">" that closes the JSX tag that opens at start. A ">" inside braces (an arrow) does not close it. */
function tagEnd(source: string, start: number): number {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    else if (source[i] === '>' && depth === 0) return i;
  }
  return source.length - 1;
}

/**
 * Finds a flex or grid box, or a start or end alignment, on a tag with its own direction (dir="auto" or dir="ltr").
 * Such a box puts its items on the side of its text, not of the page: an English name sits on the left of an Arabic
 * screen (owner, 2026-10-05). Give the direction to the text inside the box instead.
 */
export function findDirectionBox(source: string): RtlFinding[] {
  const findings: RtlFinding[] = [];
  for (const dir of source.matchAll(/\sdir="(?:auto|ltr)"/g)) {
    const start = source.lastIndexOf('<', dir.index);
    const tag = source.slice(start, tagEnd(source, start) + 1);
    const classes = /className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(tag);
    const hit = (classes?.[1] ?? classes?.[2] ?? '').match(/(?<![\w-])(?:inline-flex|flex|inline-grid|grid|text-start|text-end)(?![\w-])/);
    if (hit) findings.push({ line: source.slice(0, dir.index).split('\n').length, rule: 'Own direction on a box', match: hit[0] });
  }
  return findings;
}

/** The direction marks that GitHub flags as hidden characters: LRM, RLM, ALM, the embeddings and overrides, and the isolates. */
const RAW_MARK = /[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/g;

/**
 * Finds a raw direction mark. The code writes each one as an escape (`\u2068`), so a reader and a review see it (src/CLAUDE.md).
 * The match names the character by its code point, because the raw character shows nothing.
 */
export function findRawDirectionMark(source: string): RtlFinding[] {
  const findings: RtlFinding[] = [];
  source.split('\n').forEach((text, index) => {
    for (const match of text.matchAll(RAW_MARK)) {
      const code = match[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
      findings.push({ line: index + 1, rule: 'Raw direction mark', match: `U+${code}` });
    }
  });
  return findings;
}
