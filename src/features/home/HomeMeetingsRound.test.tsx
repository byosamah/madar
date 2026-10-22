import { describe, expect, it } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import type { State } from '../../api/store';
import { TODAY } from '../../test/factories';
import { renderHeldRemoteApp } from '../../test/heldRemoteApp';
import { todayMeetingsInput } from '../meetings/readInputs';

/**
 * Home asks meetings.list in its first request (performance audit 2026-10-21, DF-6). The card mounts only after three answers, so
 * without the early start its read went out one round trip later.
 */
const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const flush = (ms = 30) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

describe('Home and its meetings read, real build', () => {
  it('starts meetings.list with the first reads, before any answer, and the card then finds the answer', async () => {
    const { asked, release, queryClient } = await renderHeldRemoteApp('/', as('usr_002'), { hold: true });
    await flush();
    const input = todayMeetingsInput(TODAY);
    expect(asked).toContainEqual({ name: 'session.get', input: {} });
    expect(asked, 'meetings.list in the first round').toContainEqual({ name: 'meetings.list', input });
    release();
    await waitFor(() => expect(queryClient.getQueryCache().find({ queryKey: ['api', 'meetings.list', input], exact: true })?.getObserversCount()).toBeGreaterThan(0), { timeout: 10_000 });
    await flush(100);
    expect(asked.filter((call) => call.name === 'meetings.list' && JSON.stringify(call.input) === JSON.stringify(input))).toHaveLength(1);
  });
});
