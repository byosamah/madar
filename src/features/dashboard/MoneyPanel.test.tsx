import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '../../i18n';
import { MoneyPanel } from './MoneyPanel';
import type { DashboardData } from './Tiles';

const payment = { id: 'pay_1', projectId: 'prj_1', projectCode: 'P-1', name: 'Concept payment', amount: 120000, dueDate: '2026-10-20' };

describe('the money panel', () => {
  beforeEach(() => initI18n('en'));

  it('marks every amount as private, so a replay and a click record leave it out', () => {
    const view = { money: { pastDue: { count: 1, total: 120000, payments: [payment] }, next30: { count: 0, total: 0, payments: [] } } } as unknown as DashboardData;
    const { container } = render(<MemoryRouter><MoneyPanel view={view} /></MemoryRouter>);
    expect(screen.getByText('SAR 120,000')).toHaveClass('ph-no-capture');
    expect(container.textContent).toContain('SAR 120,000');
    const marked = [...container.querySelectorAll('.ph-no-capture')].map((node) => node.textContent);
    expect(marked.some((text) => text?.includes('SAR 120,000'))).toBe(true);
    // The payment name is no amount, so it stays readable.
    expect(screen.getByText('Concept payment').closest('.ph-no-capture')).toBeNull();
  });
});
