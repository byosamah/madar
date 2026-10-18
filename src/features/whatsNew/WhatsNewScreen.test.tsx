import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderApp } from '../../test/render';
import { renderRemoteApp } from '../../test/renderRemote';
import { WHATS_NEW } from '../../whatsNew/entries';

describe("What's new screen", () => {
  it('shows the title, the entry title and the entry text in English', async () => {
    await renderApp('/whats-new');
    expect(await screen.findByRole('heading', { level: 1, name: "What's new" })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'New in Madar' })).toBeInTheDocument();
    expect(screen.getByText(/Now you can archive a chat/)).toBeInTheDocument();
  });

  it('shows the Arabic title and the Arabic entry in Arabic', async () => {
    await renderApp('/whats-new', (state) => {
      state.users.usr_001.preferences.language = 'ar';
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'ما الجديد' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'الجديد في مدار' })).toBeInTheDocument();
  });

  it('marks the newest entry seen when the page opens', async () => {
    await renderApp('/whats-new');
    await screen.findByRole('heading', { level: 1, name: "What's new" });
    expect(window.localStorage.getItem('madar.whatsNewSeen.usr_001')).toBe(WHATS_NEW[0].id);
  });

  it('opens in the real build too', async () => {
    await renderRemoteApp('/whats-new');
    expect(await screen.findByRole('heading', { level: 1, name: "What's new" })).toBeInTheDocument();
    expect(screen.getByText(/Now you can archive a chat/)).toBeInTheDocument();
  });
});
