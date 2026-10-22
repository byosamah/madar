import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { RouterProvider, createMemoryRouter, useLocation, useNavigate } from 'react-router';
import { useQueryInLink } from './useQueryInLink';

// The search screen stays on screen for a moment after a result opens. The link moves first, so a write of the search text at
// that moment put "?q=" on the new page and dropped its own parameters: a file found by Search opened its project without the
// file (it failed 1 run in 8 under load, 2026-10-04).
function Harness() {
  const [query, setQuery] = useState('');
  useQueryInLink(query);
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button type="button" onClick={() => setQuery('corniche')}>type corniche</button>
      <button type="button" onClick={() => setQuery('tower')}>type tower</button>
      <button type="button" onClick={() => setQuery('')}>clear</button>
      <button type="button" onClick={() => void navigate('/projects/p1?tab=files&file=f1')}>open the file</button>
      <output>{location.pathname + location.search}</output>
    </>
  );
}

const start = (entry = '/search') => {
  const router = createMemoryRouter([{ path: '*', element: <Harness /> }], { initialEntries: [entry] });
  render(<RouterProvider router={router} />);
  return router;
};
const link = () => screen.getByRole('status').textContent;

describe('useQueryInLink', () => {
  it('writes the search text into the link of the search screen', async () => {
    start();
    await userEvent.click(screen.getByRole('button', { name: 'type corniche' }));
    expect(link()).toBe('/search?q=corniche');
  });

  it('replaces the entry, so Back does not step through every search', async () => {
    const router = start();
    await userEvent.click(screen.getByRole('button', { name: 'type corniche' }));
    await userEvent.click(screen.getByRole('button', { name: 'type tower' }));
    expect(link()).toBe('/search?q=tower');
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('keeps the parameters of the page that a result opens', async () => {
    start();
    await userEvent.click(screen.getByRole('button', { name: 'type corniche' }));
    await userEvent.click(screen.getByRole('button', { name: 'open the file' }));
    expect(link()).toBe('/projects/p1?tab=files&file=f1');
  });

  it('writes nothing when the text settles after a result opened', async () => {
    start();
    await userEvent.click(screen.getByRole('button', { name: 'open the file' }));
    await act(async () => screen.getByRole('button', { name: 'type corniche' }).click());
    expect(link()).toBe('/projects/p1?tab=files&file=f1');
  });

  it('keeps the other values of the link when it writes q, and when it clears q (Direction D, ?in=messages)', async () => {
    start('/search?in=messages');
    await userEvent.click(screen.getByRole('button', { name: 'type corniche' }));
    expect(link()).toBe('/search?in=messages&q=corniche');
    await userEvent.click(screen.getByRole('button', { name: 'clear' }));
    expect(link()).toBe('/search?in=messages');
  });
});
