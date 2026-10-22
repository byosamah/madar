import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { initI18n } from '../i18n';
import { ImageViewer, insidePicture } from './ImageViewer';
import { Sheet } from './Sheet';

beforeEach(() => {
  initI18n('en');
});

type Props = Partial<Parameters<typeof ImageViewer>[0]>;

/** A viewer that the test opens and closes the way a screen does. */
function Demo({ onDownload = () => undefined, ...rest }: Props) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <ImageViewer
        open={open}
        onClose={() => setOpen(false)}
        name="Site photo.jpg"
        src="https://store.test/full.jpg"
        placeholder="https://store.test/thumb.jpg"
        onDownload={onDownload}
        {...rest}
      />
    </>
  );
}

describe('the picture viewer (owner, 2026-10-19)', () => {
  it('opens as a dialog with the file name, the picture, a Close button and a Download button', async () => {
    const onDownload = vi.fn();
    render(<Demo onDownload={onDownload} />);
    const dialog = await screen.findByRole('dialog', { name: 'Site photo.jpg' });
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(dialog.querySelector('img[src="https://store.test/full.jpg"]')).not.toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Download Site photo.jpg' }));
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('puts the focus on the Close button when it opens', async () => {
    render(<Demo />);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus());
  });

  it('closes with the X button', async () => {
    render(<Demo />);
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes with Escape', async () => {
    render(<Demo />);
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes with a press on the dark backdrop, and stays open with a press on a button', async () => {
    const onDownload = vi.fn();
    render(<Demo onDownload={onDownload} />);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Download Site photo.jpg' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const stage = dialog.querySelector('[data-viewer-stage]') as HTMLElement;
    fireEvent.click(stage);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('knows a press on the picture from a press on the dark space around it', () => {
    // A 400 x 200 picture in a 400 x 400 box: it sits in the middle, from y = 100 to y = 300.
    const box = { left: 0, top: 0, width: 400, height: 400 };
    const natural = { width: 2000, height: 1000 };
    expect(insidePicture(box, natural, { x: 200, y: 200 })).toBe(true);
    expect(insidePicture(box, natural, { x: 200, y: 50 })).toBe(false);
    expect(insidePicture(box, natural, { x: 200, y: 350 })).toBe(false);
    // The size of the picture is not known yet: nothing to protect, so the press counts as a press on the backdrop.
    expect(insidePicture(box, null, { x: 200, y: 200 })).toBe(false);
  });

  it('keeps the viewer open when a press lands on the picture itself', async () => {
    render(<Demo />);
    const dialog = await screen.findByRole('dialog');
    const picture = dialog.querySelector('img[src="https://store.test/full.jpg"]') as HTMLImageElement;
    Object.defineProperty(picture, 'naturalWidth', { value: 100 });
    Object.defineProperty(picture, 'naturalHeight', { value: 100 });
    picture.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.load(picture);
    const stage = dialog.querySelector('[data-viewer-stage]') as HTMLElement;
    fireEvent.click(stage, { clientX: 50, clientY: 50 });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(stage, { clientX: 500, clientY: 500 });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows the small picture first, and the big one over it when it has loaded', async () => {
    render(<Demo />);
    const dialog = await screen.findByRole('dialog');
    const big = dialog.querySelector('img[src="https://store.test/full.jpg"]') as HTMLImageElement;
    const small = dialog.querySelector('img[src="https://store.test/thumb.jpg"]') as HTMLImageElement;
    expect(small).not.toBeNull();
    expect(big).toHaveClass('opacity-0');
    fireEvent.load(big);
    expect(big).not.toHaveClass('opacity-0');
  });

  it('tells the screen when the big picture breaks, and says so when no picture shows', async () => {
    const onError = vi.fn();
    const { rerender } = render(<Demo onError={onError} />);
    const dialog = await screen.findByRole('dialog');
    fireEvent.error(dialog.querySelector('img[src="https://store.test/full.jpg"]') as HTMLImageElement);
    expect(onError).toHaveBeenCalledTimes(1);
    rerender(<Demo failed src={null} placeholder={null} />);
    expect(await screen.findByText('The picture did not load. You can still download it.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download Site photo.jpg' })).toBeInTheDocument();
  });

  describe('several pictures', () => {
    const several = (onMove = vi.fn()) => ({ position: { index: 1, count: 3, onMove } });

    it('shows Previous, Next and the place, and moves with the buttons', async () => {
      const onMove = vi.fn();
      render(<Demo {...several(onMove)} />);
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('2 of 3')).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Next picture' }));
      expect(onMove).toHaveBeenLastCalledWith(2);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Previous picture' }));
      expect(onMove).toHaveBeenLastCalledWith(0);
    });

    it('moves with the arrow keys: Right is next in English', async () => {
      const onMove = vi.fn();
      render(<Demo {...several(onMove)} />);
      await screen.findByRole('dialog');
      await userEvent.keyboard('{ArrowRight}');
      expect(onMove).toHaveBeenLastCalledWith(2);
      await userEvent.keyboard('{ArrowLeft}');
      expect(onMove).toHaveBeenLastCalledWith(0);
    });

    it('follows the page direction in Arabic: Left is next', async () => {
      initI18n('ar');
      document.documentElement.dir = 'rtl';
      const onMove = vi.fn();
      render(<Demo {...several(onMove)} />);
      await screen.findByRole('dialog');
      await userEvent.keyboard('{ArrowLeft}');
      expect(onMove).toHaveBeenLastCalledWith(2);
      await userEvent.keyboard('{ArrowRight}');
      expect(onMove).toHaveBeenLastCalledWith(0);
      document.documentElement.dir = 'ltr';
    });

    it('has no Previous on the first picture, no Next on the last, and no arrow key past the end', async () => {
      const onMove = vi.fn();
      const { rerender } = render(<Demo position={{ index: 0, count: 3, onMove }} />);
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).queryByRole('button', { name: 'Previous picture' })).toBeNull();
      expect(within(dialog).getByRole('button', { name: 'Next picture' })).toBeInTheDocument();
      await userEvent.keyboard('{ArrowLeft}');
      expect(onMove).not.toHaveBeenCalled();
      rerender(<Demo position={{ index: 2, count: 3, onMove }} />);
      expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Next picture' })).toBeNull();
      await userEvent.keyboard('{ArrowRight}');
      expect(onMove).not.toHaveBeenCalled();
    });

    it('shows no Previous, Next or place for one picture', async () => {
      render(<Demo />);
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).queryByRole('button', { name: 'Next picture' })).toBeNull();
      expect(within(dialog).queryByRole('button', { name: 'Previous picture' })).toBeNull();
    });
  });

  it('gives the focus back to the control that the screen names when it closes', async () => {
    render(<Demo focusAfter={() => screen.getByRole('button', { name: 'Open' })} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus());
  });

  it('inside a sheet: a press in the viewer does not close the sheet, and Escape closes the viewer first', async () => {
    function InSheet() {
      const [sheet, setSheet] = useState(true);
      const [viewer, setViewer] = useState(false);
      return (
        <Sheet open={sheet} onOpenChange={setSheet} title="Task panel">
          <button type="button" onClick={() => setViewer(true)}>Show picture</button>
          <ImageViewer open={viewer} onClose={() => setViewer(false)} name="Site photo.jpg" src="https://store.test/full.jpg" onDownload={() => undefined} />
        </Sheet>
      );
    }
    render(<InSheet />);
    await userEvent.click(await screen.findByRole('button', { name: 'Show picture' }));
    const viewer = await screen.findByRole('dialog', { name: 'Site photo.jpg' });
    await userEvent.click(within(viewer).getByRole('button', { name: 'Download Site photo.jpg' }));
    // The sheet is hidden from the reader while the viewer is over it, so the query asks for hidden nodes too.
    expect(screen.getByRole('heading', { name: 'Task panel', hidden: true })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Site photo.jpg' })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Task panel' })).toBeInTheDocument();
  });
});

describe('the picture viewer safe area (Direction D)', () => {
  it('pads the bottom with the safe area', async () => {
    render(<Demo />);
    const dialog = await screen.findByRole('dialog', { name: 'Site photo.jpg' });
    expect(dialog.className).toContain('pb-[env(safe-area-inset-bottom)]');
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
