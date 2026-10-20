import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { AgentsSection } from './AgentsSection';
import { PasswordSection } from './PasswordSection';

describe('the screen stubs of the real build (plan T0.4)', () => {
  // The consent screen is built (task G4, src/features/oauth/ConsentScreen.test.tsx). Settings, Agents draws nothing in the prototype.
  it('render nothing until their tracks build them', () => {
    for (const Stub of [AgentsSection, PasswordSection]) {
      const { container, unmount } = render(<Stub />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});
