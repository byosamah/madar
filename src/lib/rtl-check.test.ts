import { describe, expect, it } from 'vitest';
import { findPhysicalDirection } from './rtl-check';

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
