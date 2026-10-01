import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { usePanelOpen } from './panelOpen';

function Panel({ active }: { active: boolean }) {
  usePanelOpen(active);
  return null;
}

describe('the page behind a modal panel', () => {
  it('steps back while any modal panel is open, and returns when the last one closes', () => {
    const one = render(<Panel active />);
    const two = render(<Panel active />);
    expect(document.documentElement).toHaveAttribute('data-panel-open');
    one.unmount();
    expect(document.documentElement).toHaveAttribute('data-panel-open');
    two.rerender(<Panel active={false} />);
    expect(document.documentElement).not.toHaveAttribute('data-panel-open');
  });
});
