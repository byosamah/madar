import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

type FlowNode = { id: string; type: string; data: unknown; position: { x: number; y: number }; sourcePosition?: string; targetPosition?: string };
type FlowProps = {
  nodes: FlowNode[];
  nodeTypes: Record<string, ComponentType<Record<string, unknown>>>;
  onInit?: (instance: { fitView: () => void }) => void;
  nodesDraggable?: boolean;
  nodesConnectable?: boolean;
  elementsSelectable?: boolean;
  fitView?: boolean;
};

// React Flow measures the page in a browser, which jsdom has not. The mock draws each node with its own node component,
// and keeps the last props, so a test reads what the screen asks of the map.
const flow = vi.hoisted(() => ({
  props: undefined as FlowProps | undefined,
  // What each render of the map asked for, in order. The first render decides the view that fitView sets at the start.
  renders: [] as { fitView: boolean | undefined; nodes: number }[],
  fitView: vi.fn(),
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
        props.onInit?.({ fitView: flow.fitView });
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
  flow.setCenter.mockClear();
  flow.renders.length = 0;
  vi.restoreAllMocks();
});

describe('the Open space button on the Dashboard', () => {
  it('sits beside Meeting view and opens the map', async () => {
    await renderApp('/dashboard');
    await userEvent.click(await screen.findByRole('button', { name: 'Open space' }));
    expect(await screen.findByRole('heading', { name: 'Open space' })).toBeInTheDocument();
    expect(window.location.hash).toContain('/dashboard/space');
  });
});

describe('the Open space screen', () => {
  it('shows the toolbar, and a map that the person cannot drag or join', async () => {
    await renderApp('/dashboard/space');
    expect(await screen.findByRole('heading', { name: 'Open space' })).toBeInTheDocument();
    for (const name of ['Open all', 'Close all', 'Fit to screen']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Focus on a person' })).toBeInTheDocument();
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

  it('opens and closes a stage that has tasks with Space, as a button does', async () => {
    await renderApp('/dashboard/space');
    await userEvent.click(await screen.findByRole('button', { name: 'Open all' }));
    const stage = document.querySelector<HTMLElement>('[data-kind="stage"][role="button"]');
    expect(stage).not.toBeNull();
    stage!.focus();
    await userEvent.keyboard(' ');
    expect(stage).toHaveAttribute('aria-expanded', 'false');
    await userEvent.keyboard(' ');
    expect(stage).toHaveAttribute('aria-expanded', 'true');
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

  it('opens every project and stage with Open all, and closes them with Close all', async () => {
    await renderApp('/dashboard/space');
    await userEvent.click(await screen.findByRole('button', { name: 'Open all' }));
    expect(countOf('[data-kind="stage"]')).toBeGreaterThan(0);
    expect(countOf('[data-kind="task"]')).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Close all' }));
    expect(countOf('[data-kind="stage"]')).toBe(0);
    expect(countOf('[data-kind="task"]')).toBe(0);
  });

  it('fades the tasks of the other people when a person is in Focus on a person', async () => {
    await renderApp('/dashboard/space');
    await userEvent.click(await screen.findByRole('button', { name: 'Open all' }));
    const picker = screen.getByRole('combobox', { name: 'Focus on a person' });
    const options = within(picker).getAllByRole('option') as HTMLOptionElement[];
    await userEvent.selectOptions(picker, options[1]!.value);
    const faded = countOf('[data-kind="task"][data-faded="true"]');
    const total = countOf('[data-kind="task"]');
    expect(faded).toBeGreaterThan(0);
    expect(faded + countOf('[data-kind="task"][data-faded="false"]')).toBe(total);
  });

  it('opens the project page from the Open project button of a card', async () => {
    await renderApp('/dashboard/space');
    await screen.findByRole('button', { name: /Corniche Office Tower/ });
    await userEvent.click(screen.getAllByRole('button', { name: 'Open project' })[0]!);
    await waitFor(() => expect(window.location.hash).toMatch(/#\/projects\/prj_/));
  });

  it('fits the map to the screen with Fit to screen', async () => {
    await renderApp('/dashboard/space');
    await userEvent.click(await screen.findByRole('button', { name: 'Fit to screen' }));
    expect(flow.fitView).toHaveBeenCalled();
  });
});

describe('keyboard focus on the map', () => {
  it('moves the map to a card that the keyboard focuses outside the map', async () => {
    await renderApp('/dashboard/space');
    await userEvent.click(await screen.findByRole('button', { name: 'Open all' }));
    measureCardAt({ left: 300, top: 300, right: 540, bottom: 380 });
    focusFromKeyboard(document.querySelector<HTMLElement>('[data-kind="stage"][role="button"]')!);
    expect(flow.setCenter).toHaveBeenCalledTimes(1);
    const [x, y, options] = flow.setCenter.mock.calls[0]!;
    // The map centers on a card: its start corner plus half of its size.
    expect(flow.props?.nodes.some((node) => node.position.x + 120 === x && node.position.y + 40 === y)).toBe(true);
    expect(options).toEqual({ zoom: 1, duration: 0 });
  });

  it('keeps the map still when the keyboard focuses a card inside the map', async () => {
    await renderApp('/dashboard/space');
    await userEvent.click(await screen.findByRole('button', { name: 'Open all' }));
    measureCardAt({ left: 10, top: 10, right: 50, bottom: 50 });
    focusFromKeyboard(document.querySelector<HTMLElement>('[data-kind="stage"][role="button"]')!);
    expect(flow.setCenter).not.toHaveBeenCalled();
  });
});
