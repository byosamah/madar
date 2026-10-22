import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { phoneMedia } from '../../test/phoneMedia';
import { renderApp } from '../../test/render';

describe('the Me hub (prototype, phone)', () => {
  it('draws the hub title on a phone', async () => {
    phoneMedia(true);
    await renderApp('/me');
    expect(await screen.findByRole('heading', { level: 1, name: 'Me' })).toBeInTheDocument();
  });
});
