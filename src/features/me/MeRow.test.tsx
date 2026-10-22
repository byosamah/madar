import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { initI18n } from '../../i18n';
import { SettingsIcon } from '../../components/icons/animated/settings';
import { MeChoiceRow, MeGroup, MePanel, MeRow, MeSwitchRow } from './MeRow';

const inRouter = (ui: React.ReactElement) => {
  initI18n('en');
  return render(<MemoryRouter>{ui}</MemoryRouter>);
};

describe('the row parts of the Me hub', () => {
  it('draws a link row with its lines, its value and a flipping chevron', () => {
    inRouter(<MePanel label="Settings"><MeRow icon={SettingsIcon} title="Quiet hours" lines={['Sunday to Thursday']} value="Off" to="/me/quiet-hours" /></MePanel>);
    const link = screen.getByRole('link', { name: /Quiet hours/ });
    expect(link).toHaveAttribute('href', '/me/quiet-hours');
    expect(link).toHaveTextContent('Off');
    expect(link).toHaveTextContent('Sunday to Thursday');
    expect(link.querySelector('.rtl\\:-scale-x-100')).not.toBeNull();
  });

  it('draws a press row as a button with no chevron', async () => {
    const onPress = vi.fn();
    inRouter(<MePanel><MeRow title="Request a feature" onPress={onPress} /></MePanel>);
    const button = screen.getByRole('button', { name: 'Request a feature' });
    expect(button.querySelector('.rtl\\:-scale-x-100')).toBeNull();
    await userEvent.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('lets a long title wrap to two lines', () => {
    const long = 'عبدالرحمن بن محمد بن عبدالعزيز آل سعود الكبير';
    inRouter(<MePanel><MeRow title={long} to="/me/profile" /><MeRow title="A very long English title that needs more than one line" onPress={() => undefined} /></MePanel>);
    for (const text of [long, 'A very long English title that needs more than one line']) {
      const title = screen.getByText(text);
      expect(title).toHaveClass('break-words');
      expect(title).not.toHaveClass('truncate');
    }
  });

  it('draws a switch row that names its switch and its line', async () => {
    const onChange = vi.fn();
    inRouter(<MePanel><MeSwitchRow id="away" title="Show me as Away" lines={['Online']} checked={false} onChange={onChange} /></MePanel>);
    const toggle = screen.getByRole('switch', { name: 'Show me as Away' });
    expect(toggle).toHaveAccessibleDescription('Online');
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('draws a row with a note and no switch when the switch cannot work', () => {
    inRouter(<MePanel><MeSwitchRow id="push" title="Notify me on this device" checked={false} onChange={() => undefined} showSwitch={false} note={<p role="status">Blocked</p>} /></MePanel>);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Blocked');
  });

  it('draws a choice row as a radio group', async () => {
    const onChange = vi.fn();
    inRouter(<MePanel><MeChoiceRow title="Language" layoutId="me-language" value="en" options={[{ value: 'en', label: 'English' }, { value: 'ar', label: 'العربية' }]} onChange={onChange} /></MePanel>);
    const group = screen.getByRole('radiogroup', { name: 'Language' });
    expect(group).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'العربية' }));
    expect(onChange).toHaveBeenCalledWith('ar');
  });

  it('draws a group with its word hidden from a screen reader and its panels', () => {
    inRouter(<MeGroup title="Office"><MePanel label="Office"><MeRow title="Dashboard" to="/dashboard" /></MePanel></MeGroup>);
    expect(screen.getByText('Office', { selector: 'p' })).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('list', { name: 'Office' })).toBeInTheDocument();
  });
});
