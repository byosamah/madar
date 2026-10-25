import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

type FlowNode = { id: string; type: string; data: unknown; position: { x: number; y: number }; sourcePosition?: string; targetPosition?: string };
type FlowProps = {
  nodes: FlowNode[];
  nodeTypes: Record<string, ComponentType<Record<string, unknown>>>;
  onInit?: (instance: { fitView: () => void; zoomIn: () => void; zoomOut: () => void }) => void;
  nodesDraggable?: boolean;
  nodesConnectable?: boolean;
  elementsSelectable?: boolean;
  fitView?: boolean;
  fitViewOptions?: { minZoom?: number; maxZoom?: number; nodes?: { id: string }[] };
  panOnScroll?: boolean;
  zoomOnScroll?: boolean;
  zoomActivationKeyCode?: string[];
  onlyRenderVisibleElements?: boolean;
};

// React Flow measures the page in a browser, which jsdom has not. The mock draws each node with its own node component,
// and keeps the last props, so a test reads what the screen asks of the map.
const flow = vi.hoisted(() => ({
  props: undefined as FlowProps | undefined,
  // What each render of the map asked for, in order. The first render decides the view that fitView sets at the start.
  renders: [] as { fitView: boolean | undefined; nodes: number }[],
  fitView: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  setCenter: vi.fn(),
}));

vi.mock('@xyflow/react', async () => {
  const React = await import('react');
  return {
    Position: { Left: 'left', Right: 'right' },
    Handle: () => null,
    useReactFlow: () => ({ setCenter: flow.setCenter, getZoom: () => 1 }),
    ReactFlow: (props: FlowProps) => {
      flow.props = props;
      flow.renders.push({ fitView: props.fitView, nodes: props.nodes.length });
      React.useEffect(() => {
        props.onInit?.({ fitView: flow.fitView, zoomIn: flow.zoomIn, zoomOut: flow.zoomOut });
      }, []);
      // The class "react-flow" marks the map box, as React Flow does on its own root element.
      return React.createElement('div', { 'data-testid': 'flow', className: 'react-flow' }, props.nodes.map((node) => {
        const Node = props.nodeTypes[node.type]!;
        return React.createElement(Node, {
          key: node.id,
          id: node.id,
          data: node.data,
          sourcePosition: node.sourcePosition,
          targetPosition: node.targetPosition,
          positionAbsoluteX: node.position.x,
          positionAbsoluteY: node.position.y,
        });
      }));
    },
  };
});

const countOf = (selector: string) => document.querySelectorAll(selector).length;

type Box = { left: number; top: number; right: number; bottom: number };
const MAP_BOX: Box = { left: 0, top: 0, right: 100, bottom: 100 };

// jsdom has no layout. The map measures as MAP_BOX, and every card measures as the box that the test gives.
function measureCardAt(card: Box) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const box = this.classList.contains('react-flow') ? MAP_BOX : card;
    return { x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top, top: box.top, right: box.right, bottom: box.bottom, left: box.left, toJSON: () => box } as DOMRect;
  });
}

// A keyboard user presses Tab, then the focus moves. jsdom reads that key press to show the focus as visible.
function focusFromKeyboard(element: HTMLElement) {
  fireEvent.keyDown(document.body, { key: 'Tab' });
  element.focus();
}

afterEach(() => {
  observers.list = [];
  flow.fitView.mockClear();
  flow.zoomIn.mockClear();
  flow.zoomOut.mockClear();
  flow.setCenter.mockClear();
  flow.renders.length = 0;
  vi.restoreAllMocks();
});

/** Opens the first project of the map, and gives its toggle button. */
async function openFirstProject() {
  const toggle = await screen.findByRole('button', { name: /Corniche Office Tower/ });
  await userEvent.click(toggle);
  return toggle;
}

describe('the Open space button on the Dashboard', () => {
  it('sits beside Meeting view and opens the map', async () => {
    await renderApp('/dashboard');
    await userEvent.click(await screen.findByRole('button', { name: 'Open space' }));
    expect(await screen.findByRole('heading', { name: 'Open space' })).toBeInTheDocument();
    expect(window.location.hash).toContain('/dashboard/space');
  });
});

describe('the Open space screen', () => {
  it('shows one row of controls, the way back above the title at the start, and a map that the person cannot drag or join', async () => {
    await renderApp('/dashboard/space');
    const title = await screen.findByRole('heading', { name: 'Open space' });
    const back = screen.getByRole('link', { name: 'Dashboard' });
    expect(back.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Focus on a person' })).toBeInTheDocument();
    for (const gone of ['Open all', 'Close all', 'Fit to screen']) expect(screen.queryByRole('button', { name: gone })).toBeNull();
    await waitFor(() => expect(flow.props).toBeDefined());
    expect(flow.props).toMatchObject({ nodesDraggable: false, nodesConnectable: false, elementsSelectable: false });
  });

  it('fits the whole map on its first draw, so the person sees every project card at the start', async () => {
    await renderApp('/dashboard/space');
    await screen.findByRole('button', { name: /Corniche Office Tower/ });
    const first = flow.renders[0];
    expect(first).toMatchObject({ fitView: true });
    expect(first?.nodes ?? 0).toBeGreaterThan(1);
  });

  it('shows the office and one card for each open project, and never a completed project', async () => {
    await renderApp('/dashboard/space');
    const card = await screen.findByRole('button', { name: /Corniche Office Tower/ });
    expect(card).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /Gulf Crest HQ Interiors/ })).toBeInTheDocument();
    expect(screen.queryByText('Dune Line Show Villa')).toBeNull();
    expect(countOf('[data-kind="office"]')).toBe(1);
    expect(countOf('[data-kind="project"]')).toBe(11);
    expect(countOf('[data-kind="stage"]')).toBe(0);
  });

  // PRJ-05: the first view already answers the manager, with no level to open.
  it('shows the stages, the open tasks and the tasks past due on each project card', async () => {
    const { api } = await renderApp('/dashboard/space');
    const card = (await screen.findByRole('button', { name: /Corniche Office Tower/ })).closest<HTMLElement>('[data-kind="project"]')!;
    const { project, stages } = (await api.call('projects.list', { status: 'all' })).find((item) => item.project.name === 'Corniche Office Tower')!;
    expect(project.name).toBe('Corniche Office Tower');
    const facts = within(card).getByText(new RegExp(`^${stages.length} stages?$`)).closest<HTMLElement>('[data-facts]')!;
    expect(within(facts).getByText(/open to-dos?$/)).toBeInTheDocument();
  });

  it('opens and closes a project with Enter, and shows its stages', async () => {
    await renderApp('/dashboard/space');
    const card = await screen.findByRole('button', { name: /Corniche Office Tower/ });
    card.focus();
    await userEvent.keyboard('{Enter}');
    expect(card).toHaveAttribute('aria-expanded', 'true');
    expect(countOf('[data-kind="stage"]')).toBeGreaterThan(0);
    await userEvent.keyboard('{Enter}');
    expect(card).toHaveAttribute('aria-expanded', 'false');
    expect(countOf('[data-kind="stage"]')).toBe(0);
  });

  it('opens and closes a project with Space, as a button does', async () => {
    await renderApp('/dashboard/space');
    const toggle = await screen.findByRole('button', { name: /Corniche Office Tower/ });
    toggle.focus();
    await userEvent.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens one project at a time: a second project closes the first', async () => {
    await renderApp('/dashboard/space');
    const first = await openFirstProject();
    expect(first).toHaveAttribute('aria-expanded', 'true');
    const second = screen.getByRole('button', { name: /Gulf Crest HQ Interiors/ });
    await userEvent.click(second);
    expect(second).toHaveAttribute('aria-expanded', 'true');
    expect(first).toHaveAttribute('aria-expanded', 'false');
    const stages = [...document.querySelectorAll('[data-kind="stage"]')];
    expect(stages.length).toBeGreaterThan(0);
    // The stages on the map are the stages of the second project only.
    expect(countOf('[data-kind="project"][data-open="true"]')).toBe(1);
  });

  it('opens a stage that has tasks with Space, as a button does, and keeps the project open', async () => {
    await renderApp('/dashboard/space');
    await openFirstProject();
    const stage = document.querySelector<HTMLElement>('[data-kind="stage"][role="button"]');
    expect(stage).not.toBeNull();
    stage!.focus();
    await userEvent.keyboard(' ');
    expect(stage).toHaveAttribute('aria-expanded', 'true');
    expect(countOf('[data-kind="task"]')).toBeGreaterThan(0);
    await userEvent.keyboard(' ');
    expect(stage).toHaveAttribute('aria-expanded', 'false');
    expect(countOf('[data-kind="project"][data-open="true"]')).toBe(1);
  });

  it('lays out a card from the end side in Arabic, so the tile and the words follow the language', async () => {
    await renderApp('/dashboard/space', (state) => {
      state.users.usr_001.preferences.language = 'ar';
    });
    await waitFor(() => expect(countOf('[data-kind="project"]')).toBe(11));
    // The page itself carries dir="rtl" in Arabic, so the test looks for the nearest dir attribute on the card.
    const direction = document.querySelector('[data-kind="project"]')?.closest('[dir]');
    expect(direction).not.toBe(document.documentElement);
    expect(direction).toHaveAttribute('dir', 'rtl');
  });

  it('shows the small logo of the sub-company beside the picture of a project (fbk_007)', async () => {
    await renderApp('/dashboard/space', (state) => {
      state.subCompanies = { sub_001: { id: 'sub_001', name: 'Vado', nameAr: 'فادو', logo: null, createdBy: 'usr_001', createdAt: '2026-10-18T09:00:00.000+03:00' } };
      for (const project of Object.values(state.projects)) delete project.subCompanyId;
      state.projects.prj_001.subCompanyId = 'sub_001';
    });
    await waitFor(() => expect(countOf('[data-kind="project"]')).toBeGreaterThan(0));
    await waitFor(() => expect(countOf('[data-kind="project"] [data-sub-company-badge]')).toBe(1));
  });

  it('opens the project page from the icon button of a card, which is 44 px and has a name', async () => {
    await renderApp('/dashboard/space');
    await screen.findByRole('button', { name: /Corniche Office Tower/ });
    const open = screen.getAllByRole('button', { name: 'Open project' })[0]!;
    expect(open.className).toContain('size-11');
    await userEvent.click(open);
    await waitFor(() => expect(window.location.hash).toMatch(/#\/projects\/prj_/));
  });

  it('lets a card take a mouse press, which React Flow leaves out of a read-only map', async () => {
    await renderApp('/dashboard/space');
    const card = (await screen.findByRole('button', { name: /Corniche Office Tower/ })).closest('[data-kind="project"]') ?? screen.getByRole('button', { name: /Corniche Office Tower/ });
    expect(card.className).toContain('pointer-events-auto');
  });
});

describe('the view of the map (PRJ-05)', () => {
  it('asks for a readable first view, and the plain wheel moves the map while Control or Command and the wheel zoom it', async () => {
    await renderApp('/dashboard/space');
    await screen.findByRole('button', { name: /Corniche Office Tower/ });
    expect(flow.props).toMatchObject({ fitViewOptions: { minZoom: 0.7 }, panOnScroll: true, zoomOnScroll: false });
    expect(flow.props?.zoomActivationKeyCode).toEqual(expect.arrayContaining(['Control', 'Meta']));
    // The first view shows the office and the first four projects, from the top, not the whole tree.
    const shown = flow.props!.fitViewOptions!.nodes!.map((node) => node.id);
    expect(shown[0]).toBe('office');
    expect(shown).toHaveLength(5);
  });

  it('shows the first three projects alone on a phone, so the cards stay readable', async () => {
    const width = window.innerWidth;
    window.innerWidth = 390;
    try {
      await renderApp('/dashboard/space');
      await screen.findByRole('button', { name: /Corniche Office Tower/ });
      const shown = flow.props!.fitViewOptions!.nodes!.map((node) => node.id);
      expect(shown).toHaveLength(3);
      expect(shown).not.toContain('office');
      expect(flow.props!.fitViewOptions!.minZoom).toBe(0.45);
    } finally {
      window.innerWidth = width;
    }
  });

  it('moves the view to the project and its stages when a project opens', async () => {
    await renderApp('/dashboard/space');
    await openFirstProject();
    await waitFor(() => expect(flow.fitView).toHaveBeenCalledTimes(1));
    const options = flow.fitView.mock.lastCall![0] as { minZoom: number; nodes: { id: string }[] };
    expect(options.minZoom).toBe(0.7);
    const ids = options.nodes.map((node) => node.id);
    expect(ids[0]).toMatch(/^prj_/);
    expect(ids.slice(1).every((id) => id.startsWith('stg_'))).toBe(true);
    expect(ids.length).toBeGreaterThan(1);
  });

  it('moves the view to the new level alone on a phone, so the cards stay readable', async () => {
    const width = window.innerWidth;
    window.innerWidth = 390;
    try {
      await renderApp('/dashboard/space');
      await openFirstProject();
      await waitFor(() => expect(flow.fitView).toHaveBeenCalledTimes(1));
      const ids = (flow.fitView.mock.lastCall![0] as { nodes: { id: string }[] }).nodes.map((node) => node.id);
      expect(ids.length).toBeGreaterThan(1);
      expect(ids.every((id) => id.startsWith('stg_'))).toBe(true);
    } finally {
      window.innerWidth = width;
    }
  });

  it('moves the view to a stage and its tasks when a stage opens', async () => {
    await renderApp('/dashboard/space');
    await openFirstProject();
    await waitFor(() => expect(flow.fitView).toHaveBeenCalledTimes(1));
    const stage = document.querySelector<HTMLElement>('[data-kind="stage"][role="button"]')!;
    await userEvent.click(stage);
    await waitFor(() => expect(flow.fitView).toHaveBeenCalledTimes(2));
    const ids = (flow.fitView.mock.lastCall![0] as { nodes: { id: string }[] }).nodes.map((node) => node.id);
    expect(ids.some((id) => id.startsWith('prj_'))).toBe(true);
    expect(ids.some((id) => id.startsWith('stg_'))).toBe(true);
    expect(ids.some((id) => id.startsWith('tsk_'))).toBe(true);
  });

  it('goes back to the first view when the open project closes, and with Overview', async () => {
    await renderApp('/dashboard/space');
    const toggle = await openFirstProject();
    await waitFor(() => expect(flow.fitView).toHaveBeenCalledTimes(1));
    await userEvent.click(toggle);
    await waitFor(() => expect(flow.fitView).toHaveBeenCalledTimes(2));
    expect((flow.fitView.mock.lastCall![0] as { nodes: { id: string }[] }).nodes[0]!.id).toBe('office');
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(countOf('[data-kind="stage"]')).toBe(0);
    await waitFor(() => expect(flow.fitView).toHaveBeenCalledTimes(4));
    expect((flow.fitView.mock.lastCall![0] as { nodes: { id: string }[] }).nodes[0]!.id).toBe('office');
  });

  it('zooms in and out with the two buttons at the bottom start of the map', async () => {
    await renderApp('/dashboard/space');
    await screen.findByRole('button', { name: /Corniche Office Tower/ });
    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(flow.zoomIn).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(flow.zoomOut).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Zoom in' }).parentElement?.className).toContain('start-3');
  });
});

describe('the focus on a person (PRJ-06)', () => {
  it('offers only active people who lead or help an open task, never an agent', async () => {
    await renderApp('/dashboard/space');
    await screen.findByRole('button', { name: /Corniche Office Tower/ });
    const picker = screen.getByRole('combobox', { name: 'Focus on a person' });
    const names = within(picker).getAllByRole('option').map((option) => option.textContent);
    expect(names[0]).toBe('Everyone');
    expect(names.length).toBeGreaterThan(2);
    expect(names).not.toContain('Madar Assistant');
  });

  it('opens the projects and stages where the person works, fades the rest, and says how much work that is', async () => {
    await renderApp('/dashboard/space');
    await screen.findByRole('button', { name: /Corniche Office Tower/ });
    expect(countOf('[data-kind="stage"]')).toBe(0);
    const picker = screen.getByRole('combobox', { name: 'Focus on a person' });
    const option = within(picker).getAllByRole('option')[1] as HTMLOptionElement;
    await userEvent.selectOptions(picker, option.value);
    // The closed first view changes at once: projects open, and the ones without the person fade.
    expect(countOf('[data-kind="project"][data-open="true"]')).toBeGreaterThan(0);
    expect(countOf('[data-kind="project"][data-faded="true"]')).toBeGreaterThan(0);
    expect(countOf('[data-kind="task"][data-faded="false"]')).toBeGreaterThan(0);
    expect(countOf('[data-kind="stage"][data-faded="true"]')).toBeGreaterThan(0);
    expect(screen.getByText(new RegExp(`^${option.textContent}: \\d+ open to-dos? in \\d+ projects?$`))).toBeInTheDocument();
    await waitFor(() => expect(flow.fitView).toHaveBeenCalled());
    // Everyone closes the map again.
    await userEvent.selectOptions(picker, '');
    expect(countOf('[data-kind="stage"]')).toBe(0);
    expect(countOf('[data-faded="true"]')).toBe(0);
  });
});

describe('the task card (PRJ-08)', () => {
  it('opens the task panel over the map, with the task in the link', async () => {
    await renderApp('/dashboard/space');
    await openFirstProject();
    await userEvent.click(document.querySelector<HTMLElement>('[data-kind="stage"][role="button"]')!);
    const task = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-kind="task"]');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(task).toHaveAttribute('role', 'button');
    await userEvent.click(task);
    await waitFor(() => expect(window.location.hash).toMatch(/task=tsk_\d+/));
    expect(window.location.hash).toContain('/dashboard/space');
    expect(window.location.hash).toMatch(/project=prj_\d+/);
    expect(await screen.findByRole('dialog', undefined, { timeout: 10_000 })).toBeInTheDocument();
  });
});

describe('the Dashboard filters (INT-11)', () => {
  it('shows only the projects of the leader in the link, and says what it shows', async () => {
    const { api } = await renderApp('/dashboard/space?leader=usr_002');
    const expected = (await api.call('projects.list', { status: 'all', leaderId: 'usr_002' })).filter((row) => row.project.status === 'active' || row.project.status === 'on_hold');
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(11);
    await waitFor(() => expect(countOf('[data-kind="project"]')).toBe(expected.length));
    expect(await screen.findByText(/^Showing: Leader: /)).toBeInTheDocument();
  });

  it('keeps the filters in the way back to the Dashboard', async () => {
    await renderApp('/dashboard/space?leader=usr_002');
    expect(await screen.findByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', expect.stringContaining('/dashboard?leader=usr_002'));
  });
});

describe('keyboard focus on the map', () => {
  it('moves the map to a card that the keyboard focuses outside the map', async () => {
    await renderApp('/dashboard/space');
    await openFirstProject();
    measureCardAt({ left: 300, top: 300, right: 540, bottom: 380 });
    focusFromKeyboard(document.querySelector<HTMLElement>('[data-kind="stage"][role="button"]')!);
    expect(flow.setCenter).toHaveBeenCalledTimes(1);
    const [x, y, options] = flow.setCenter.mock.calls[0]!;
    // The map centers on a card: its start corner plus half of its size.
    expect(flow.props?.nodes.some((node) => node.position.x + 144 === x && node.position.y + 31 === y)).toBe(true);
    expect(options).toEqual({ zoom: 1, duration: 0 });
  });

  it('keeps the map still when the keyboard focuses a card inside the map', async () => {
    await renderApp('/dashboard/space');
    await openFirstProject();
    measureCardAt({ left: 10, top: 10, right: 50, bottom: 50 });
    focusFromKeyboard(document.querySelector<HTMLElement>('[data-kind="stage"][role="button"]')!);
    expect(flow.setCenter).not.toHaveBeenCalled();
  });
});

// fbk_055 (2026-10-25): the Detail control, the sub-company column, the fit on a resize, and the zoom on a wide screen.
type Size = { width: number; height: number };
const observers = vi.hoisted(() => ({ list: [] as { callback: (entries: { contentRect: Size }[]) => void; element: Element }[] }));

class FakeResizeObserver {
  constructor(private readonly callback: (entries: { contentRect: Size }[]) => void) {}
  observe(element: Element) {
    observers.list.push({ callback: this.callback, element });
  }
  unobserve() {}
  disconnect() {
    observers.list = observers.list.filter((item) => item.callback !== this.callback);
  }
}

/** The map box tells its size to the screen. This is what the browser does when the window changes. */
function resizeMapTo(size: Size) {
  const map = observers.list.filter((item) => item.element.hasAttribute('data-space-map'));
  expect(map.length).toBeGreaterThan(0);
  for (const item of map) item.callback([{ contentRect: size }]);
}

/** The sample office has some checklists. A test that counts checklist cards starts with none. */
const clearChecklists = (state: State) => {
  for (const task of Object.values(state.tasks)) task.checklist = [];
};

const idsOfLastFit = () => (flow.fitView.mock.lastCall![0] as { nodes: { id: string }[] }).nodes.map((node) => node.id);
const addSubCompanies = (state: State) => {
  state.subCompanies = {
    sub_001: { id: 'sub_001', name: 'Vado', nameAr: 'فادو', logo: null, createdBy: 'usr_001', createdAt: '2026-10-18T09:00:00.000+03:00' },
    sub_002: { id: 'sub_002', name: 'Alfa', nameAr: 'ألفا', logo: null, createdBy: 'usr_001', createdAt: '2026-10-18T09:00:00.000+03:00' },
  };
  for (const project of Object.values(state.projects)) delete project.subCompanyId;
  state.projects.prj_001!.subCompanyId = 'sub_001';
  state.projects.prj_002!.subCompanyId = 'sub_002';
};

function withWindow(width: number, run: () => Promise<void>) {
  const before = window.innerWidth;
  window.innerWidth = width;
  return run().finally(() => {
    window.innerWidth = before;
  });
}

describe('the Detail control (fbk_055)', () => {
  const group = () => screen.getByRole('group', { name: 'Detail' });
  const press = (name: 'Show more' | 'Show less') => userEvent.click(within(group()).getByRole('button', { name }));

  it('shows Show less, the name of the step and Show more, and starts at Projects with Show less off when the office has no sub-company', async () => {
    await renderApp('/dashboard/space');
    await screen.findByRole('button', { name: /Corniche Office Tower/ });
    expect(within(group()).getByText('Projects')).toBeInTheDocument();
    expect(within(group()).getByRole('button', { name: 'Show less' })).toBeDisabled();
    expect(within(group()).getByRole('button', { name: 'Show more' })).toBeEnabled();
  });

  it('opens one more level for every project with Show more, down to the checklists, and goes back with Show less', async () => {
    await renderApp('/dashboard/space', (state) => {
      clearChecklists(state);
      // The first open to-do of the first project gets a checklist, so the last step has a card to show.
      const task = Object.values(state.tasks).find((item) => item.projectId === 'prj_001' && item.status !== 'done' && item.stageId)!;
      task.checklist = [{ id: 'ci_1', text: 'Check the grid', done: false }, { id: 'ci_2', text: 'Send the set', done: true }];
    });
    await screen.findByRole('button', { name: /Corniche Office Tower/ });
    await press('Show more');
    expect(within(group()).getByText('Stages')).toBeInTheDocument();
    expect(countOf('[data-kind="project"][data-open="true"]')).toBe(11);
    expect(countOf('[data-kind="stage"]')).toBeGreaterThan(11);
    expect(countOf('[data-kind="task"]')).toBe(0);
    await press('Show more');
    expect(within(group()).getByText('To-dos and deadlines')).toBeInTheDocument();
    expect(countOf('[data-kind="task"]')).toBeGreaterThan(0);
    expect(countOf('[data-kind="deadline"]')).toBeGreaterThan(0);
    expect(countOf('[data-kind="check"]')).toBe(0);
    await press('Show more');
    expect(within(group()).getByText('Checklists')).toBeInTheDocument();
    expect(countOf('[data-kind="check"]')).toBe(2);
    expect(screen.getByText('Check the grid')).toBeInTheDocument();
    expect(within(group()).getByRole('button', { name: 'Show more' })).toBeDisabled();
    await press('Show less');
    expect(countOf('[data-kind="check"]')).toBe(0);
    await press('Show less');
    await press('Show less');
    expect(within(group()).getByText('Projects')).toBeInTheDocument();
    expect(countOf('[data-kind="stage"]')).toBe(0);
  });

  it('shows a deadline card with its name and date, and a checklist card that says done or not done', async () => {
    await renderApp('/dashboard/space', (state) => {
      state.deadlines.ddl_900 = { id: 'ddl_900', projectId: 'prj_001', stageId: null, name: 'Balady visit', date: '2026-11-05' };
      const task = Object.values(state.tasks).find((item) => item.projectId === 'prj_001' && item.status !== 'done' && item.stageId)!;
      task.checklist = [{ id: 'ci_1', text: 'Check the grid', done: false }, { id: 'ci_2', text: 'Send the set', done: true }];
    });
    await screen.findByRole('button', { name: /Corniche Office Tower/ });
    for (let step = 0; step < 3; step += 1) await press('Show more');
    const deadline = [...document.querySelectorAll<HTMLElement>('[data-kind="deadline"]')].find((card) => card.textContent?.includes('Balady visit'))!;
    expect(within(deadline).getByText(/Nov/)).toBeInTheDocument();
    expect(within(deadline).getByText('Deadline')).toBeInTheDocument();
    const done = screen.getByText('Send the set').closest<HTMLElement>('[data-kind="check"]')!;
    expect(within(done).getByText('Done')).toBeInTheDocument();
    expect(within(screen.getByText('Check the grid').closest<HTMLElement>('[data-kind="check"]')!).getByText('Not done')).toBeInTheDocument();
  });

  it('shows a "more" card that opens the to-do after the first 12 items of a checklist', async () => {
    await renderApp('/dashboard/space', (state) => {
      clearChecklists(state);
      const task = Object.values(state.tasks).find((item) => item.projectId === 'prj_001' && item.status !== 'done' && item.stageId)!;
      task.checklist = Array.from({ length: 15 }, (_, index) => ({ id: `ci_${index + 1}`, text: `Item ${index + 1}`, done: false }));
    });
    await screen.findByRole('button', { name: /Corniche Office Tower/ });
    for (let step = 0; step < 3; step += 1) await press('Show more');
    expect(countOf('[data-kind="check"]')).toBe(12);
    const more = document.querySelector<HTMLElement>('[data-kind="more"]')!;
    expect(more).toHaveTextContent('3 more items');
    await userEvent.click(more);
    await waitFor(() => expect(window.location.hash).toMatch(/task=tsk_\d+/));
  });

  it('asks for a readable fit of the top rows at each step, never the whole map', async () => {
    await renderApp('/dashboard/space');
    await screen.findByRole('button', { name: /Corniche Office Tower/ });
    await press('Show more');
    await waitFor(() => expect(flow.fitView).toHaveBeenCalledTimes(1));
    await press('Show more');
    await waitFor(() => expect(flow.fitView).toHaveBeenCalledTimes(2));
    const ids = idsOfLastFit();
    expect(ids[0]).toBe('office');
    expect(ids.length).toBeGreaterThan(2);
    expect(ids.length).toBeLessThan(flow.props!.nodes.length);
    expect(flow.fitView.mock.lastCall![0]).toMatchObject({ minZoom: 0.7 });
  });

  it('closes only the project that the person taps at the Stages step, and a step change clears the taps', async () => {
    await renderApp('/dashboard/space');
    const first = await screen.findByRole('button', { name: /Corniche Office Tower/ });
    await press('Show more');
    const second = screen.getByRole('button', { name: /Gulf Crest HQ Interiors/ });
    expect(first).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(second).toHaveAttribute('aria-expanded', 'true');
    expect(countOf('[data-kind="project"][data-open="true"]')).toBe(10);
    await press('Show more');
    await press('Show less');
    expect(within(group()).getByText('Stages')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Corniche Office Tower/ })).toHaveAttribute('aria-expanded', 'true');
    expect(countOf('[data-kind="project"][data-open="true"]')).toBe(11);
  });

  it('keeps opening one project at a time at the Projects step', async () => {
    await renderApp('/dashboard/space');
    const first = await openFirstProject();
    await userEvent.click(screen.getByRole('button', { name: /Gulf Crest HQ Interiors/ }));
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(countOf('[data-kind="project"][data-open="true"]')).toBe(1);
  });

  it('puts a stage back to closed when the person taps it at the To-dos step', async () => {
    await renderApp('/dashboard/space');
    await screen.findByRole('button', { name: /Corniche Office Tower/ });
    await press('Show more');
    await press('Show more');
    const stage = document.querySelector<HTMLElement>('[data-kind="stage"][role="button"][aria-expanded="true"]')!;
    const tasksBefore = countOf('[data-kind="task"]');
    await userEvent.click(stage);
    expect(stage).toHaveAttribute('aria-expanded', 'false');
    expect(countOf('[data-kind="task"]')).toBeLessThan(tasksBefore);
  });

  it('keeps the opens of a person in focus when the step changes', async () => {
    await renderApp('/dashboard/space');
    await screen.findByRole('button', { name: /Corniche Office Tower/ });
    const picker = screen.getByRole('combobox', { name: 'Focus on a person' });
    await userEvent.selectOptions(picker, (within(picker).getAllByRole('option')[1] as HTMLOptionElement).value);
    const open = countOf('[data-kind="project"][data-open="true"]');
    expect(open).toBeGreaterThan(0);
    await press('Show more');
    expect(countOf('[data-kind="project"][data-open="true"]')).toBe(11);
    await userEvent.selectOptions(picker, '');
    expect(countOf('[data-kind="project"][data-open="true"]')).toBe(11);
  });

  it('words the control in Arabic', async () => {
    await renderApp('/dashboard/space', (state) => {
      state.users.usr_001.preferences.language = 'ar';
    });
    const arGroup = await screen.findByRole('group', { name: 'التفاصيل' });
    expect(within(arGroup).getByRole('button', { name: 'أظهر المزيد' })).toBeInTheDocument();
    expect(within(arGroup).getByRole('button', { name: 'أظهر أقل' })).toBeDisabled();
    expect(within(arGroup).getByText('المشاريع')).toBeInTheDocument();
  });
});

describe('the sub-company column (fbk_055)', () => {
  const group = () => screen.getByRole('group', { name: 'Detail' });

  it('shows one card for each sub-company and "No sub-company", with the projects after them, and Show less opens the Sub-companies step', async () => {
    await renderApp('/dashboard/space', addSubCompanies);
    await screen.findByRole('button', { name: /Corniche Office Tower/ });
    const cards = [...document.querySelectorAll<HTMLElement>('[data-kind="subcompany"]')];
    expect(cards.map((card) => card.textContent)).toEqual([expect.stringContaining('Alfa'), expect.stringContaining('Vado'), expect.stringContaining('No sub-company')]);
    expect(countOf('[data-kind="project"]')).toBe(11);
    const less = within(group()).getByRole('button', { name: 'Show less' });
    expect(less).toBeEnabled();
    await userEvent.click(less);
    expect(within(group()).getByText('Sub-companies')).toBeInTheDocument();
    expect(countOf('[data-kind="project"]')).toBe(0);
    expect(countOf('[data-kind="subcompany"]')).toBe(3);
    expect(within(group()).getByRole('button', { name: 'Show less' })).toBeDisabled();
  });

  it('opens the projects of one sub-company when the person taps its card, at the Sub-companies step', async () => {
    await renderApp('/dashboard/space', addSubCompanies);
    await screen.findByRole('button', { name: /Corniche Office Tower/ });
    await userEvent.click(within(group()).getByRole('button', { name: 'Show less' }));
    const vado = screen.getByRole('button', { name: /Vado/ });
    await userEvent.click(vado);
    expect(vado).toHaveAttribute('aria-expanded', 'true');
    expect(countOf('[data-kind="project"]')).toBe(1);
    await userEvent.click(vado);
    expect(countOf('[data-kind="project"]')).toBe(0);
  });

  it('shows how many projects and how many to-dos past due a sub-company has', async () => {
    await renderApp('/dashboard/space', addSubCompanies);
    await screen.findByRole('button', { name: /Corniche Office Tower/ });
    const alfa = [...document.querySelectorAll<HTMLElement>('[data-kind="subcompany"]')].find((card) => card.textContent?.includes('Alfa'))!;
    expect(within(alfa).getByText('1 project')).toBeInTheDocument();
    const none = [...document.querySelectorAll<HTMLElement>('[data-kind="subcompany"]')].find((card) => card.textContent?.includes('No sub-company'))!;
    expect(within(none).getByText('9 projects')).toBeInTheDocument();
  });

  it('shows no column when the link already filters one sub-company, and the steps start at Projects', async () => {
    await renderApp('/dashboard/space?subCompany=sub_001', addSubCompanies);
    await waitFor(() => expect(countOf('[data-kind="project"]')).toBe(1));
    expect(countOf('[data-kind="subcompany"]')).toBe(0);
    expect(within(group()).getByRole('button', { name: 'Show less' })).toBeDisabled();
    expect(within(group()).getByText('Projects')).toBeInTheDocument();
  });

  it('shows no column when the office has no sub-company', async () => {
    await renderApp('/dashboard/space');
    await screen.findByRole('button', { name: /Corniche Office Tower/ });
    expect(countOf('[data-kind="subcompany"]')).toBe(0);
  });

  it('keeps the office, the sub-company and the project cards in their own columns, mirrored in Arabic', async () => {
    await renderApp('/dashboard/space', (state) => {
      addSubCompanies(state);
      state.users.usr_001.preferences.language = 'ar';
    });
    await waitFor(() => expect(countOf('[data-kind="project"]')).toBe(11));
    const xOf = (kind: string) => flow.props!.nodes.find((node) => (node.data as { kind: string }).kind === kind)!.position.x;
    expect(xOf('office') + 0).toBe(0);
    expect(xOf('subcompany')).toBe(-340);
    expect(xOf('project')).toBe(-680);
  });
});

describe('the fit of the map (fbk_055)', () => {
  it('lets the map zoom to 1 up to a 1400 px window, and further on a wide screen up to 1.6 at 2200 px', async () => {
    for (const [width, expected] of [[1024, 1], [1400, 1], [1800, 1.3], [2200, 1.6], [3000, 1.6]] as const) {
      await withWindow(width, async () => {
        await renderApp('/dashboard/space');
        await screen.findByRole('button', { name: /Corniche Office Tower/ });
        expect(flow.props!.fitViewOptions!.maxZoom).toBeCloseTo(expected, 5);
      });
      cleanup();
    }
  });

  it('lets the map itself zoom to 1.6, and draws only the cards that are in view', async () => {
    await renderApp('/dashboard/space');
    await screen.findByRole('button', { name: /Corniche Office Tower/ });
    expect(flow.props).toMatchObject({ maxZoom: 1.6, onlyRenderVisibleElements: true });
  });

  it('fits again to the last target when the map box changes, after 150 ms with no change, and only by a change of 10 percent or more', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    try {
      await renderApp('/dashboard/space');
      await openFirstProject();
      await waitFor(() => expect(flow.fitView).toHaveBeenCalledTimes(1));
      const target = idsOfLastFit();
      // The first size: the screen fits to the target once.
      resizeMapTo({ width: 1000, height: 600 });
      expect(flow.fitView).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(flow.fitView).toHaveBeenCalledTimes(2));
      expect(idsOfLastFit()).toEqual(target);
      expect(flow.fitView.mock.lastCall![0]).toMatchObject({ duration: 0 });
      // A change of 5 percent: no new fit.
      resizeMapTo({ width: 1050, height: 630 });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(flow.fitView).toHaveBeenCalledTimes(2);
      // Three quick changes of more than 10 percent give one fit, after the last one.
      resizeMapTo({ width: 1200, height: 700 });
      resizeMapTo({ width: 1300, height: 800 });
      resizeMapTo({ width: 1400, height: 900 });
      expect(flow.fitView).toHaveBeenCalledTimes(2);
      await waitFor(() => expect(flow.fitView).toHaveBeenCalledTimes(3));
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(flow.fitView).toHaveBeenCalledTimes(3);
      expect(idsOfLastFit()).toEqual(target);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fits a phone turn through the same path: the phone view with no office, then the desk view', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    try {
      await withWindow(390, async () => {
        await renderApp('/dashboard/space');
        await screen.findByRole('button', { name: /Corniche Office Tower/ });
        resizeMapTo({ width: 390, height: 600 });
        await waitFor(() => expect(flow.fitView).toHaveBeenCalledTimes(1));
        expect(idsOfLastFit()).not.toContain('office');
        expect(flow.fitView.mock.lastCall![0]).toMatchObject({ minZoom: 0.45 });
        window.innerWidth = 844;
        resizeMapTo({ width: 844, height: 300 });
        await waitFor(() => expect(flow.fitView).toHaveBeenCalledTimes(2));
        expect(idsOfLastFit()[0]).toBe('office');
        expect(flow.fitView.mock.lastCall![0]).toMatchObject({ minZoom: 0.7 });
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows as many projects at first as fit the box at the zoom of the window, and at least three', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const projectsOfFit = () => idsOfLastFit().filter((id) => id.startsWith('prj_')).length;
    try {
      await withWindow(1424, async () => {
        await renderApp('/dashboard/space');
        await screen.findByRole('button', { name: /Corniche Office Tower/ });
        resizeMapTo({ width: 1424, height: 1316 });
        await waitFor(() => expect(flow.fitView).toHaveBeenCalledTimes(1));
        expect(projectsOfFit()).toBe(7);
        resizeMapTo({ width: 1424, height: 562 });
        await waitFor(() => expect(flow.fitView).toHaveBeenCalledTimes(2));
        expect(projectsOfFit()).toBe(3);
        resizeMapTo({ width: 1424, height: 300 });
        await waitFor(() => expect(flow.fitView).toHaveBeenCalledTimes(3));
        expect(projectsOfFit()).toBe(3);
      });
      cleanup();
      observers.list = [];
      flow.fitView.mockClear();
      await withWindow(2848, async () => {
        await renderApp('/dashboard/space');
        await screen.findByRole('button', { name: /Corniche Office Tower/ });
        resizeMapTo({ width: 2800, height: 1316 });
        await waitFor(() => expect(flow.fitView).toHaveBeenCalledTimes(1));
        // At the zoom of a wide window the cards are big, so fewer rows fit than at zoom 1.
        expect(projectsOfFit()).toBe(4);
        expect(flow.fitView.mock.lastCall![0]).toMatchObject({ maxZoom: 1.6 });
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('moves the view to the new level alone on a phone at each step', async () => {
    await withWindow(390, async () => {
      await renderApp('/dashboard/space');
      await screen.findByRole('button', { name: /Corniche Office Tower/ });
      await userEvent.click(within(screen.getByRole('group', { name: 'Detail' })).getByRole('button', { name: 'Show more' }));
      await waitFor(() => expect(flow.fitView).toHaveBeenCalledTimes(1));
      const ids = idsOfLastFit();
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.every((id) => id.startsWith('stg_'))).toBe(true);
    });
  });
});

describe('the speed of the map (fbk_055)', () => {
  it('keeps the data of a card that a tap did not touch, so the map redraws only what changed', async () => {
    await renderApp('/dashboard/space');
    await openFirstProject();
    const dataOf = (id: string) => flow.props!.nodes.find((node) => node.id === id)!.data;
    const other = flow.props!.nodes.find((node) => (node.data as { kind: string }).kind === 'project' && !(node.data as { open: boolean }).open)!.id;
    const before = dataOf(other);
    const stage = document.querySelector<HTMLElement>('[data-kind="stage"][role="button"]')!;
    await userEvent.click(stage);
    expect(dataOf(other)).toBe(before);
  });
});

describe('a hidden project on the map (fbk_055, the leak test of its deadlines)', () => {
  it('never shows the project, its stages, its to-dos or its deadlines to a person who may not see it', async () => {
    await renderApp('/dashboard/space', (state) => {
      state.projects.prj_001!.access = { hidden: true, viewerIds: [] };
      state.projects.prj_001!.leaderId = 'usr_002';
      for (const key of Object.keys(state.members)) if (state.members[key]!.projectId === 'prj_001') delete state.members[key];
      state.users.usr_001.systemRole = 'member';
      state.deadlines.ddl_secret = { id: 'ddl_secret', projectId: 'prj_001', stageId: null, name: 'Secret handover', date: '2026-11-03' };
    });
    await screen.findByRole('button', { name: /Gulf Crest HQ Interiors/ });
    for (let step = 0; step < 3; step += 1) await userEvent.click(within(screen.getByRole('group', { name: 'Detail' })).getByRole('button', { name: 'Show more' }));
    expect(screen.queryByText('Corniche Office Tower')).toBeNull();
    expect(screen.queryByText('Secret handover')).toBeNull();
    expect(document.body.textContent).not.toContain('Secret handover');
    expect(flow.props!.nodes.some((node) => node.id === 'ddl_secret' || node.id === 'prj_001')).toBe(false);
    // The map still shows the other projects and their deadlines.
    expect(countOf('[data-kind="deadline"]')).toBeGreaterThan(0);
  });
});
