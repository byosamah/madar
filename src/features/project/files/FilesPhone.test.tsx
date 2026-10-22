import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { State } from '../../../api/store';
import { phoneMedia } from '../../../test/phoneMedia';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const FILES = '/projects/prj_001?tab=files';

describe('the Files & Links tab on a phone (phone D, P9)', () => {
  it('makes Add the navy button, as a sheet of rows', async () => {
    phoneMedia(true);
    await renderApp(FILES, as('usr_002'));
    const add = await screen.findByRole('button', { name: 'Add' });
    expect(add).toHaveClass('signature');
    await userEvent.click(add);
    expect(await screen.findByText('Upload a file')).toBeInTheDocument();
    expect(screen.getByText('Add a link')).toBeInTheDocument();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('shows no drop hint and takes no drop on a phone', async () => {
    phoneMedia(true);
    const { store } = await renderApp(FILES, as('usr_002'));
    await screen.findByRole('button', { name: 'Add' });
    expect(screen.queryByText('Drop files here to upload them.')).toBeNull();
    const before = Object.keys(store.state.files).length;
    const tab = screen.getByRole('tabpanel').firstElementChild as HTMLElement;
    fireEvent.drop(tab, { dataTransfer: { files: [new File(['x'], 'Dropped.txt', { type: 'text/plain' })], types: ['Files'] } });
    expect(Object.keys(store.state.files)).toHaveLength(before);
  });

  it('opens the preview from the name or the thumbnail', async () => {
    phoneMedia(true);
    const { store } = await renderApp(FILES, as('usr_002'));
    // The sample office keeps no file data. The test stores a small PDF for the file, as an upload would.
    const file = Object.values(store.state.files).find((item) => item.name === 'Ground floor plan.pdf')!;
    await store.persister.putBlob(file.versions[file.versions.length - 1].blobKey, new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
    await userEvent.click(await screen.findByRole('button', { name: 'View Ground floor plan.pdf' }));
    const link = await screen.findByRole('link', { name: 'Open the PDF' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('keeps Preview in the row menu, as a sheet of rows', async () => {
    phoneMedia(true);
    await renderApp(FILES, as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Ground floor plan.pdf' }));
    expect(await screen.findByText('Preview')).toBeInTheDocument();
    expect(screen.getByText('Download')).toBeInTheDocument();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps the stage pick and the "Received from the client" tick', async () => {
    phoneMedia(true);
    await renderApp(FILES, as('usr_002'));
    expect(await screen.findByLabelText('Stage for new files')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Received from the client' })).toBeInTheDocument();
  });

  it('gives the file row button a 44 px press area', async () => {
    phoneMedia(true);
    await renderApp(FILES, as('usr_002'));
    // The row button was 42 px high by its content, so it has a minimum height.
    expect(await screen.findByRole('button', { name: 'View Ground floor plan.pdf' })).toHaveClass('min-h-11');
  });

  it('keeps the "Received from the client" tick inside a label of 44 px, and a press on the label turns it on', async () => {
    phoneMedia(true);
    await renderApp(FILES, as('usr_002'));
    // The native tick stays 20 px: Chromium and WebKit ignore padding on it. The press area is the label that holds it, as for a switch row.
    const tick = (await screen.findByRole('checkbox', { name: 'Received from the client' })) as HTMLInputElement;
    const label = tick.closest('label') as HTMLElement;
    expect(label).toHaveClass('min-h-11');
    expect(tick.checked).toBe(false);
    await userEvent.click(within(label).getByText('Received from the client'));
    expect(tick.checked).toBe(true);
  });

  it('shows no Add button to a person with no upload and no link right', async () => {
    phoneMedia(true);
    await renderApp(FILES, as('usr_003'));
    await screen.findByRole('region', { name: 'Construction Documents' }, { timeout: 10_000 }).catch(() => undefined);
    await screen.findByRole('tab', { name: 'Files & Links' });
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
  });

  it('keeps the desk: grey Add menu, drop hint, no row press button', async () => {
    await renderApp(FILES, as('usr_002'));
    const add = await screen.findByRole('button', { name: 'Add' });
    expect(add).not.toHaveClass('signature');
    expect(screen.getByText('Drop files here to upload them.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View Ground floor plan.pdf' })).toBeNull();
    const group = await screen.findByRole('region', { name: 'Construction Documents' });
    expect(within(group).getByText('Ground floor plan.pdf')).toBeInTheDocument();
  });
});
