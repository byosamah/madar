import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ConsentScreen } from '../oauth/ConsentScreen';
import { AgentsSection } from './AgentsSection';
import { PasswordSection } from './PasswordSection';
import { UsageSection } from './admin/UsageSection';

describe('the screen stubs of the real build (plan T0.4)', () => {
  it('render nothing until their tracks build them', () => {
    for (const Stub of [ConsentScreen, AgentsSection, PasswordSection, UsageSection]) {
      const { container, unmount } = render(<Stub />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});
