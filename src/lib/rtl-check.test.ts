import { describe, expect, it } from 'vitest';
import { findDirectionBox, findPhysicalDirection, findRawDirectionMark } from './rtl-check';

const flagged = [
  'ml-4', 'mr-2', 'pl-3', 'pr-1', 'left-0', 'right-4', '-left-2', 'text-left', 'text-right', 'float-left',
  'border-l', 'border-r-2', 'rounded-tl-lg', 'rounded-r-xl', 'margin-left: 4px;', 'padding-right: 8px;',
  'left: 0;', 'right: 12px;', 'text-align: right;', 'style={{ marginLeft: 8 }}',
];
const allowed = [
  'ms-4', 'me-2', 'ps-3', 'pe-1', 'start-0', 'end-4', 'text-start', 'text-end', 'border-s', 'border-e-2',
  'rounded-ss-lg', 'rounded-e-xl', 'margin-inline-start: 4px;', 'inset-inline-start: 0;', 'text-align: start;',
  'paddingInlineStart', 'top-left', 'highlight', 'copyright: 2026', 'left: number;', 'px-4', 'mx-auto',
];

describe('findPhysicalDirection', () => {
  it.each(flagged)('flags %s', (text) => {
    expect(findPhysicalDirection(`<div className="${text}">`)).not.toEqual([]);
  });

  it.each(allowed)('allows %s', (text) => {
    expect(findPhysicalDirection(`<div className="${text}">`)).toEqual([]);
  });

  it('reports the line number', () => {
    expect(findPhysicalDirection('a\nb ml-2')[0]).toMatchObject({ line: 2, match: 'ml-2' });
  });

  it('skips a line marked rtl-ok', () => {
    expect(findPhysicalDirection('<rect style={{ left: 0 }} /> // rtl-ok')).toEqual([]);
  });
});

// A flex or grid box with its own direction puts its items on the side of the text, not of the page:
// an English name then sits on the left of an Arabic screen. Only the text inside the box takes dir="auto".
describe('findDirectionBox', () => {
  const flagged = [
    '<span dir="auto" className="flex min-w-0 gap-1">',
    '<div dir="ltr" className="inline-grid">',
    '<p dir="auto" className="text-start">',
    '<div\n  dir="auto"\n  className={`grid ${cols}`}\n>',
    '<input onChange={(e) => set(e.target.value)} dir="auto" className="inline-flex" />',
  ];
  const allowed = [
    '<bdi dir="auto" className="min-w-0 truncate">',
    '<div className="flex items-center"><bdi dir="auto">Concept</bdi></div>',
    '<p dir="auto" className="flex-1 text-body">',
    '<input onChange={(e) => set(e.target.value)} dir="auto" className="field" />',
    '<TextField id="name" dir="auto" label="Name" />',
  ];

  it.each(flagged)('flags %s', (text) => {
    expect(findDirectionBox(text)).not.toEqual([]);
  });

  it.each(allowed)('allows %s', (text) => {
    expect(findDirectionBox(text)).toEqual([]);
  });

  it('reports the line of dir', () => {
    expect(findDirectionBox('a\n<span\n  dir="auto" className="flex">')[0]).toMatchObject({ line: 3, match: 'flex' });
  });
});

// GitHub flags a hidden direction character in the code (src/CLAUDE.md). The code writes each one as an escape, such as `\u2068`.
describe('findRawDirectionMark', () => {
  const codes = [0x200e, 0x200f, 0x061c, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
  const nameOf = (code: number) => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;

  it.each(codes.map((code) => [nameOf(code), code] as const))('flags the raw character %s', (name, code) => {
    expect(findRawDirectionMark(`const a = \`${String.fromCodePoint(code)}name\`;`)).toEqual([{ line: 1, rule: 'Raw direction mark', match: name }]);
  });

  it('allows the escapes and Arabic words', () => {
    expect(findRawDirectionMark('const a = `\\u2068${name}\\u2069`; // \\u200F')).toEqual([]);
    expect(findRawDirectionMark("t('chat.placeholderPhone') // اكتب @ لذكر أحد.")).toEqual([]);
  });

  it('reports the line of each mark', () => {
    const text = `a\nb ${String.fromCodePoint(0x2068)}x${String.fromCodePoint(0x2069)}`;
    expect(findRawDirectionMark(text)).toEqual([
      { line: 2, rule: 'Raw direction mark', match: 'U+2068' },
      { line: 2, rule: 'Raw direction mark', match: 'U+2069' },
    ]);
  });
});
