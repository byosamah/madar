import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ToastProvider, useToast } from '../app/toasts';
import { initI18n } from '../i18n';
import { TextField } from './Fields';
import { ContextMenu, Menu, useContextMenu } from './Menu';
import { Popover } from './Popover';
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
      return <button type="button" onClick={() => toast.show({ message: 'Saved.', action: { label: 'Undo', run: vi.fn() } })}>Save</button>;
    }
    render(
      <ToastProvider>
        <Sheet open onOpenChange={() => undefined} title="Task"><Inside /></Sheet>
      </ToastProvider>,
    );
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Task' })).getByText('Save'));
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });
});
