import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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
};

// React Flow measures the page in a browser, which jsdom has not. The mock draws each node with its own node component,
// and keeps the last props, so a test reads what the screen asks of the map.
const flow = vi.hoisted(() => ({ props: undefined as FlowProps | undefined, fitView: vi.fn() }));

vi.mock('@xyflow/react', async () => {
  const React = await import('react');
  return {
    Position: { Left: 'left', Right: 'right' },
    Handle: () => null,
    ReactFlow: (props: FlowProps) => {
      flow.props = props;
      React.useEffect(() => {
        props.onInit?.({ fitView: flow.fitView });
      }, []);
      return React.createElement('div', { 'data-testid': 'flow' }, props.nodes.map((node) => {
        const Node = props.nodeTypes[node.type]!;
        return React.createElement(Node, { key: node.id, id: node.id, data: node.data, sourcePosition: node.sourcePosition, targetPosition: node.targetPosition });
      }));
    },
  };
});

const countOf = (selector: string) => document.querySelectorAll(selector).length;

afterEach(() => {
  flow.fitView.mockClear();
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
    expect(flow.props).toMatchObject({ nodesDraggable: false, nodesConnectable: false, elementsSelectable: false });
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
    const card = await screen.findByRole('button', { name: /Corniche Office Tower/ });
    await userEvent.click(within(card).getByRole('button', { name: 'Open project' }));
    await waitFor(() => expect(window.location.hash).toMatch(/#\/projects\/prj_/));
  });

  it('fits the map to the screen with Fit to screen', async () => {
    await renderApp('/dashboard/space');
    await userEvent.click(await screen.findByRole('button', { name: 'Fit to screen' }));
    expect(flow.fitView).toHaveBeenCalled();
  });
});
