import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  fitViewOptions?: { minZoom?: number; nodes?: { id: string }[] };
  panOnScroll?: boolean;
  zoomOnScroll?: boolean;
  zoomActivationKeyCode?: string[];
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
