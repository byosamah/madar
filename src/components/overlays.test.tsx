import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { ToastProvider, useToast } from '../app/toasts';
import { initI18n } from '../i18n';
import { TextField } from './Fields';
import { ContextMenu, Menu, useContextMenu } from './Menu';
import { Popover } from './Popover';
import { SegmentedControl } from './SegmentedControl';
import { Sheet } from './Sheet';
import { TabPanel, Tabs } from './Tabs';

beforeEach(() => {
  initI18n('en');
});

describe('overlays', () => {
  it('opens a sheet with its title and closes it with Escape', async () => {
    function Demo() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open</button>
          <Sheet open={open} onOpenChange={setOpen} title="New Project">
            <TextField id="name" label="Name" />
          </Sheet>
        </>
      );
    }
    render(<Demo />);
    await userEvent.click(screen.getByText('Open'));
    const dialog = await screen.findByRole('dialog', { name: 'New Project' });
    expect(within(dialog).getByLabelText('Name')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('moves through a menu with the keyboard and hides items the viewer may not use', async () => {
    const onEdit = vi.fn();
    render(
      <Menu
        label="Project actions"
        items={[
          { label: 'Edit', onSelect: onEdit },
          { label: 'Delete', onSelect: vi.fn(), hidden: true },
          { label: 'Archive', onSelect: vi.fn() },
        ]}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Project actions' });
    await userEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Project actions' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Edit', 'Archive']);
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: 'Archive' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('shows no menu button when every item is hidden', () => {
    render(<Menu label="Project actions" items={[{ label: 'Delete', onSelect: vi.fn(), hidden: true }]} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('opens a context menu at the pointer', async () => {
    function Card() {
      const menu = useContextMenu();
      return (
        <div data-testid="card" {...menu.handlers}>
          Card
          <ContextMenu label="Card actions" items={[{ label: 'Open', onSelect: vi.fn() }]} point={menu.point} onClose={menu.close} />
        </div>
      );
    }
    render(<Card />);
    fireEvent.contextMenu(screen.getByTestId('card'), { clientX: 40, clientY: 50 });
    expect(await screen.findByRole('menu', { name: 'Card actions' })).toBeInTheDocument();
  });

  it('closes a popover with Escape and gives the focus back', async () => {
    function Demo() {
      const [anchor, setAnchor] = useState<HTMLElement | null>(null);
      return (
        <>
          <button type="button" onClick={(event) => setAnchor(event.currentTarget)}>Health</button>
          {anchor && <Popover anchor={anchor} label="Set health" onClose={() => setAnchor(null)}><button type="button">Inside</button></Popover>}
        </>
      );
    }
    render(<Demo />);
    await userEvent.click(screen.getByText('Health'));
    expect(screen.getByRole('dialog', { name: 'Set health' })).toBeInTheDocument();
    expect(screen.getByText('Inside')).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Health')).toHaveFocus();
  });

  it('closes a popover when the focus leaves it, and keeps the focus where it went (audit 2026-10-03, SHL-20)', async () => {
    function Demo() {
      const [anchor, setAnchor] = useState<HTMLElement | null>(null);
      const close = () => {
        // Like the Filter button: closing gives the focus back to the control.
        anchor?.focus();
        setAnchor(null);
      };
      return (
        <>
          <button type="button">Before</button>
          <button type="button" onClick={(event) => setAnchor(event.currentTarget)}>Health</button>
          {anchor && <Popover anchor={anchor} label="Set health" onClose={close}><button type="button">Inside</button></Popover>}
        </>
      );
    }
    render(<Demo />);
    await userEvent.click(screen.getByText('Health'));
    expect(screen.getByText('Inside')).toHaveFocus();
    // The first Tab leaves the page (as to the address bar); the next one comes back to the first control.
    await userEvent.tab();
    await userEvent.tab();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Before')).toHaveFocus();
  });

  it('moves between tabs with the arrow keys', async () => {
    function Demo() {
      const [tab, setTab] = useState<'one' | 'two'>('one');
      return (
        <>
          <Tabs label="Sections" value={tab} onChange={setTab} options={[{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }]} />
          <TabPanel value={tab}>{tab}</TabPanel>
        </>
      );
    }
    render(<Demo />);
    screen.getByRole('tab', { name: 'One' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('two');
  });

  it('keeps toasts reachable for screen readers while a sheet is open', async () => {
    function Inside() {
      const toast = useToast();
      return <button type="button" onClick={() => toast.show({ message: 'Saved.', action: { label: 'Undo', run: vi.fn(), isUndo: true } })}>Save</button>;
    }
    render(
      <ToastProvider>
        <Sheet open onOpenChange={() => undefined} title="Task"><Inside /></Sheet>
      </ToastProvider>,
    );
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Task' })).getByText('Save'));
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('moves the choice of a segmented control with the arrow keys, with one Tab stop (audit 2026-10-03, SHL-18)', async () => {
    function Demo() {
      const [value, setValue] = useState<'a' | 'b' | 'c'>('a');
      return (
        <>
          <SegmentedControl label="Theme" value={value} onChange={setValue} options={[{ value: 'a', label: 'System' }, { value: 'b', label: 'Light' }, { value: 'c', label: 'Dark' }]} />
          <button type="button">After</button>
        </>
      );
    }
    render(<Demo />);
    const radio = (name: string) => screen.getByRole('radio', { name });
    expect(radio('System')).toHaveAttribute('tabindex', '0');
    expect(radio('Light')).toHaveAttribute('tabindex', '-1');
    radio('System').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(radio('Light')).toBeChecked();
    expect(radio('Light')).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(radio('Dark')).toBeChecked();
    await userEvent.keyboard('{ArrowRight}');
    expect(radio('System')).toBeChecked();
    await userEvent.tab();
    expect(screen.getByText('After')).toHaveFocus();
    // In Arabic the left arrow moves forward, the same as the tabs.
    document.documentElement.dir = 'rtl';
    radio('System').focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(radio('Light')).toBeChecked();
  });

  it('draws a menu at the page level, so no clipping box cuts it off', async () => {
    render(
      <div data-testid="clip" style={{ overflow: 'hidden', height: 40 }}>
        <Menu label="Project actions" items={[{ label: 'Edit', onSelect: vi.fn() }, { label: 'Delete', onSelect: vi.fn() }]} />
      </div>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Project actions' }));
    expect(screen.getByTestId('clip')).not.toContainElement(screen.getByRole('menu'));
  });
});

describe('overlays after the audit of 2026-10-03', () => {
  it('opens a "…" menu inside a blocking sheet that the keyboard and the mouse can use (SHL-1)', async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <Sheet open onOpenChange={() => undefined} title="Task">
        <Menu label="Comment actions" items={[{ label: 'Edit', onSelect: onEdit }, { label: 'Delete', onSelect: onDelete }]} />
      </Sheet>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Task' });
    const trigger = within(dialog).getByRole('button', { name: 'Comment actions' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const menu = await screen.findByRole('menu', { name: 'Comment actions' });
    expect(dialog).toContainElement(menu);
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onDelete).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    // Escape closes the menu only; the sheet stays open.
    await userEvent.click(trigger);
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Task' })).toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('keeps the page usable next to a non-blocking panel (SHL-2)', async () => {
    function Demo() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open task</button>
          <label htmlFor="quick">Quick add</label>
          <input id="quick" />
          <Sheet open={open} onOpenChange={setOpen} title="Task panel" blocking={false}>
            <button type="button">Inside</button>
          </Sheet>
        </>
      );
    }
    render(<Demo />);
    await userEvent.click(screen.getByText('Open task'));
    const panel = await screen.findByRole('dialog', { name: 'Task panel' });
    expect(panel).not.toHaveAttribute('aria-modal', 'true');
    expect(document.body.style.pointerEvents).not.toBe('none');
    expect(screen.getByLabelText('Quick add').closest('[aria-hidden="true"]')).toBeNull();
    await userEvent.click(screen.getByText('Inside'));
    await userEvent.click(screen.getByLabelText('Quick add'));
    await userEvent.keyboard('abc');
    expect(screen.getByLabelText('Quick add')).toHaveValue('abc');
    expect(screen.getByRole('dialog', { name: 'Task panel' })).toBeInTheDocument();
    // Escape from inside the panel closes it, and the focus goes back to the control that opened it.
    screen.getByText('Inside').focus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Open task')).toHaveFocus();
  });

  // The app runs in StrictMode, which runs each effect twice in development. The second run must not take the panel itself
  // for the opener. The task panel leaves the page on close, so this panel does too (audit 2026-10-03, sheet repair).
  it('gives the focus back to the opener when a non-blocking panel leaves the page, also in StrictMode', async () => {
    function Demo() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open task</button>
          {open && (
            <Sheet open onOpenChange={setOpen} title="Task panel" blocking={false}>
              <button type="button">Inside</button>
            </Sheet>
          )}
        </>
      );
    }
    render(<StrictMode><Demo /></StrictMode>);
    screen.getByText('Open task').focus();
    await userEvent.keyboard('{Enter}');
    const panel = await screen.findByRole('dialog', { name: 'Task panel' });
    await waitFor(() => expect(panel).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Open task')).toHaveFocus();
  });

  function UndoInside({ run }: { run: () => void }) {
    const toast = useToast();
    return <button type="button" onClick={() => toast.show({ message: 'Deleted.', action: { label: 'Undo', run, isUndo: true } })}>Delete</button>;
  }

  it('runs the newest Undo with Ctrl+Z or Cmd+Z, also inside a blocking sheet (SHL-3)', async () => {
    const run = vi.fn();
    render(
      <ToastProvider>
        <Sheet open onOpenChange={() => undefined} title="Task">
          <UndoInside run={run} />
          <TextField id="note" label="Note" />
        </Sheet>
      </ToastProvider>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Task' });
    await userEvent.click(within(dialog).getByText('Delete'));
    expect(await screen.findByRole('button', { name: 'Undo' })).toHaveAttribute('aria-keyshortcuts', 'Control+Z Meta+Z');
    // In a text field, Ctrl+Z stays the undo of the typing.
    await userEvent.click(within(dialog).getByLabelText('Note'));
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(run).not.toHaveBeenCalled();
    within(dialog).getByText('Delete').focus();
    await userEvent.keyboard('{Meta>}z{/Meta}');
    expect(run).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull());
  });

  it('does not close a blocking sheet when the person presses Undo in a toast (SHL-3)', async () => {
    const onOpenChange = vi.fn();
    const run = vi.fn();
    render(
      <ToastProvider>
        <Sheet open onOpenChange={onOpenChange} title="Task"><UndoInside run={run} /></Sheet>
      </ToastProvider>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Task' });
    await userEvent.click(within(dialog).getByText('Delete'));
    const undo = await screen.findByRole('button', { name: 'Undo' });
    // jsdom has no Tailwind, so the press goes to the button directly, as pointer-events-auto lets it in a browser.
    fireEvent.pointerDown(undo);
    fireEvent.pointerUp(undo);
    fireEvent.click(undo);
    expect(run).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('does not close a blocking sheet when the toast is gone before the press ends, as in a browser (audit 2026-10-03, V-11)', async () => {
    const onOpenChange = vi.fn();
    const run = vi.fn();
    render(
      <ToastProvider>
        <Sheet open onOpenChange={onOpenChange} title="Task"><UndoInside run={run} /></Sheet>
      </ToastProvider>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Task' });
    await userEvent.click(within(dialog).getByText('Delete'));
    const undo = await screen.findByRole('button', { name: 'Undo' });
    // Radix waits 0 ms before it listens for presses.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    // The press starts on Undo. Radix decides at the click; in a browser React has removed the toast by then.
    // A test cannot get that order from one click, so the toast goes first (Ctrl+Z runs the same Undo), then the click comes.
    fireEvent.pointerDown(undo, { button: 0, pointerType: 'touch' });
    await userEvent.keyboard('{Control>}z{/Control}');
    await waitFor(() => expect(undo.isConnected).toBe(false));
    fireEvent.click(document.body);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(run).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('keeps a toast while the pointer or the focus is on it (SHL-3)', async () => {
    vi.useFakeTimers();
    try {
      function Show() {
        const toast = useToast();
        return <button type="button" onClick={() => toast.show({ message: 'Deleted.', action: { label: 'Undo', run: vi.fn(), isUndo: true } })}>Delete</button>;
      }
      render(<ToastProvider><Show /></ToastProvider>);
      fireEvent.click(screen.getByText('Delete'));
      const toast = screen.getByRole('status');
      fireEvent.pointerEnter(toast);
      act(() => vi.advanceTimersByTime(8000));
      expect(screen.getByRole('status')).toBeInTheDocument();
      fireEvent.pointerLeave(toast);
      fireEvent.focus(screen.getByRole('button', { name: 'Undo' }));
      act(() => vi.advanceTimersByTime(8000));
      expect(screen.getByRole('status')).toBeInTheDocument();
      fireEvent.blur(screen.getByRole('button', { name: 'Undo' }));
      act(() => vi.advanceTimersByTime(5100));
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets the other toasts time out after the toast under the pointer goes away (audit 2026-10-03, V-15)', async () => {
    vi.useFakeTimers();
    try {
      function Show() {
        const toast = useToast();
        const [n, setN] = useState(0);
        return <button type="button" onClick={() => { setN(n + 1); toast.show({ message: `Saved ${n + 1}.`, action: { label: `Undo ${n + 1}`, run: vi.fn(), isUndo: true } }); }}>Save</button>;
      }
      render(<ToastProvider><Show /></ToastProvider>);
      fireEvent.click(screen.getByText('Save'));
      fireEvent.click(screen.getByText('Save'));
      // The pointer rests on the first toast and presses its Undo. The toast goes away under the pointer, with no leave event.
      fireEvent.pointerEnter(screen.getAllByRole('status')[0]);
      fireEvent.click(screen.getByRole('button', { name: 'Undo 1' }));
      expect(screen.getAllByRole('status')).toHaveLength(1);
      act(() => vi.advanceTimersByTime(5100));
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives the focus back to its opener when a field inside took the focus first (audit 2026-10-03, V-10)', async () => {
    function Demo() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>From a template</button>
          {open && <Sheet open onOpenChange={setOpen} title="Why?"><textarea aria-label="Reason" autoFocus /></Sheet>}
        </>
      );
    }
    render(<Demo />);
    const opener = screen.getByText('From a template');
    opener.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByLabelText('Reason')).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('moves the focus to the new copy of a rebuilt opener, else to its panel, else to the page title, never to the body (V-10)', async () => {
    function Demo({ sameId }: { sameId: boolean }) {
      const [open, setOpen] = useState(false);
      const [round, setRound] = useState(0);
      return (
        <main>
          <h1>Corniche Office Tower</h1>
          <div role="dialog" aria-label="Stair details" tabIndex={-1}>
            {(sameId || round === 0) && <input key={round} id="task-due" aria-label="Due date" onKeyDown={(event) => { if (event.key === 'Enter') setOpen(true); }} />}
          </div>
          <Sheet open={open} onOpenChange={(value) => { setOpen(value); if (!value) setRound((n) => n + 1); }} title="Why do the dates change?"><textarea aria-label="Reason" /></Sheet>
        </main>
      );
    }
    const closeFrom = async () => {
      screen.getByLabelText('Due date').focus();
      await userEvent.keyboard('{Enter}');
      await screen.findByRole('dialog', { name: 'Why do the dates change?' });
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Why do the dates change?' })).toBeNull());
    };
    // The field is built again with the same id: the focus goes to the new field.
    const first = render(<Demo sameId />);
    await closeFrom();
    await waitFor(() => expect(screen.getByLabelText('Due date')).toHaveFocus());
    first.unmount();
    // The field is gone: the focus goes to the panel that held it.
    const second = render(<Demo sameId={false} />);
    await closeFrom();
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Stair details' })).toHaveFocus());
    second.unmount();
    // No panel: the focus goes to the title of the page.
    function Plain() {
      const [open, setOpen] = useState(false);
      return (
        <main>
          <h1>Corniche Office Tower</h1>
          {!open && <button type="button" onClick={() => setOpen(true)}>Move back</button>}
          <Sheet open={open} onOpenChange={setOpen} title="Why?"><textarea aria-label="Reason" /></Sheet>
        </main>
      );
    }
    render(<Plain />);
    await userEvent.click(screen.getByText('Move back'));
    await screen.findByRole('dialog', { name: 'Why?' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus());
  });

  it('moves the focus into a blocking sheet: to its first field, or to its title (BRW-2)', async () => {
    function Demo({ withField }: { withField: boolean }) {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open</button>
          <Sheet open={open} onOpenChange={setOpen} title="New Project" footer={<button type="button">Save</button>}>
            {withField ? <TextField id="name" label="Name" /> : <p>Nothing to fill in.</p>}
          </Sheet>
        </>
      );
    }
    const first = render(<Demo withField />);
    await userEvent.click(screen.getByText('Open'));
    const dialog = await screen.findByRole('dialog', { name: 'New Project' });
    await waitFor(() => expect(within(dialog).getByLabelText('Name')).toHaveFocus());
    first.unmount();
    render(<Demo withField={false} />);
    await userEvent.click(screen.getByText('Open'));
    const plain = await screen.findByRole('dialog', { name: 'New Project' });
    await waitFor(() => expect(within(plain).getByRole('heading', { name: 'New Project' })).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Open')).toHaveFocus();
  });
});

