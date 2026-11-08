import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { PreviewAs } from './PreviewAs';
import { renderWithRuntime } from '../test/render';

// The remote build: no prototype controls.
vi.mock('./mode', () => ({ REMOTE: true, PROTOTYPE: false }));

describe('Preview as in the real build', () => {
  it('draws nothing, not even the select of the enterprises', async () => {
    const { container } = await renderWithRuntime(<div data-testid="holder"><PreviewAs id="x" /></div>);
    await screen.findByTestId('holder');
    expect(container.querySelector('select')).toBeNull();
  });
});
