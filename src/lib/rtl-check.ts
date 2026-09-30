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
