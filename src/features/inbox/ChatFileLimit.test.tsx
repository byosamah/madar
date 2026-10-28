import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

const MB = 1024 * 1024;
const rowLink = async (name: RegExp) => within(await screen.findByRole('list', { name: 'Chats' })).getByRole('link', { name });
const sized = (name: string, megabytes: number) => {
  const file = new File(['x'], name, { type: 'application/octet-stream' });
  Object.defineProperty(file, 'size', { value: megabytes * MB });
  return file;
};

describe('the file limit of a chat box (fbk_070)', () => {
  it('refuses a file over 250 MB in a direct chat, and keeps it out of the chips', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    await userEvent.upload(await screen.findByLabelText('Attach files'), sized('Mosque IFC.dwg', 251));
    expect(await screen.findByText('Mosque IFC.dwg is larger than 250 MB.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Files to send' })).toBeNull();
  });

  it('takes a file of 250 MB in a direct chat', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Faisal Al-Harbi/));
    await userEvent.upload(await screen.findByLabelText('Attach files'), sized('Model.dwg', 250));
    expect(within(await screen.findByRole('list', { name: 'Files to send' })).getByText('Model.dwg')).toBeInTheDocument();
  });

  it('takes a file of 400 MB in a project chat, because it joins the files of its project', async () => {
    await renderApp('/inbox');
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    await userEvent.upload(await screen.findByLabelText('Attach files'), sized('Model.dwg', 400));
    expect(within(await screen.findByRole('list', { name: 'Files to send' })).getByText('Model.dwg')).toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText('Attach files'), sized('Huge.dwg', 501));
    expect(await screen.findByText('Huge.dwg is larger than 500 MB.')).toBeInTheDocument();
  });
});
