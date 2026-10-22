import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRuntime } from '../../test/render';
import { FileChip } from './Attachments';

describe('the file chip on a phone (Direction D)', () => {
  it('grows to 44 px under 640 px, for a file and for a removed file', async () => {
    await renderWithRuntime(
      <>
        <FileChip file={{ id: 'fil_1', name: 'Plan.pdf', size: 10, mime: 'application/pdf' } as never} />
        <FileChip file={{ id: 'fil_2', name: null } as never} />
      </>,
    );
    expect(screen.getByRole('button', { name: /Plan\.pdf/ })).toHaveClass('min-h-8', 'max-sm:min-h-11');
    expect(screen.getByText('File removed').closest('span')).toHaveClass('min-h-8', 'max-sm:min-h-11');
  });
});
