import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { AGENT, OMAR, makeBubble, renderLog, rowOf } from './logHarness';

describe('runs in the message log (design item 2)', () => {
  it('shows the face and the name once, and the time of a next message beside its bubble on hover or focus', () => {
    renderLog({ bubbles: [
      makeBubble({ id: 'msg_1', createdAt: '2026-09-29T10:00:00.000+03:00', body: 'First line.' }),
      makeBubble({ id: 'msg_2', createdAt: '2026-09-29T10:04:00.000+03:00', body: 'Second line.' }),
    ] });
    const first = rowOf('First line.');
    const second = rowOf('Second line.');
    expect(within(first).getByRole('img', { name: 'Faisal Al-Harbi' })).toBeInTheDocument();
    expect(within(first).getByText('Faisal Al-Harbi')).toBeInTheDocument();
    expect(within(second).queryByRole('img', { name: 'Faisal Al-Harbi' })).toBeNull();
    expect(within(second).queryByText('Faisal Al-Harbi')).toBeNull();
    expect(second).toHaveAttribute('data-message-id', 'msg_2');
    const time = second.querySelector('time');
    expect(time).toHaveAttribute('dateTime', '2026-09-29T10:04:00.000+03:00');
    expect(time?.closest('[data-part="side"]')).not.toBeNull();
    // Opacity, not visibility: a screen reader still reads the time.
    expect(time?.className).toMatch(/(^|\s)opacity-0(\s|$)/);
    expect(time?.className).toMatch(/group-hover:opacity-100/);
    expect(time?.className).toMatch(/group-focus-within:opacity-100/);
    expect(first.querySelector('[data-part="side"] time')).toBeNull();
  });
  it('keeps the Agent label and "for <name>" on each agent message', () => {
    renderLog({ bubbles: [
      makeBubble({ id: 'msg_1', author: AGENT, actingFor: OMAR, createdAt: '2026-09-29T10:00:00.000+03:00', body: 'Notes one.' }),
      makeBubble({ id: 'msg_2', author: AGENT, actingFor: OMAR, createdAt: '2026-09-29T10:01:00.000+03:00', body: 'Notes two.' }),
    ] });
    for (const text of ['Notes one.', 'Notes two.']) {
      expect(within(rowOf(text)).getByText('Agent')).toBeInTheDocument();
      expect(within(rowOf(text)).getByText('for Omar Haddad')).toBeInTheDocument();
    }
  });
  it('reads in Arabic right to left with the same runs', () => {
    renderLog({ bubbles: [
      makeBubble({ id: 'msg_1', createdAt: '2026-09-29T10:00:00.000+03:00', body: 'السطر الأول.' }),
      makeBubble({ id: 'msg_2', createdAt: '2026-09-29T10:02:00.000+03:00', body: 'السطر الثاني.' }),
    ] }, { lang: 'ar' });
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('log', { name: 'الرسائل' })).toBeInTheDocument();
    expect(within(rowOf('السطر الثاني.')).queryByRole('img')).toBeNull();
  });
});
