import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import i18n from 'i18next';
import { initI18n } from '../i18n';
import { PicturesContext } from '../app/pictures';
import { Avatar, initialsOf } from './Avatar';

beforeEach(() => {
  initI18n('en');
});

const PICTURE = 'data:image/webp;base64,UklGRiIAAABXRUJQ';
const faisal = { id: 'usr_002', name: 'Faisal Al-Harbi', nameAr: 'فيصل الحربي', avatarUrl: null, kind: 'human' as const };

describe('the person picture with two names and a profile picture (owner items 10 and 12)', () => {
  it('names the person in the screen language and takes the initials from the shown name', async () => {
    render(<Avatar user={faisal} />);
    expect(screen.getByRole('img', { name: 'Faisal Al-Harbi' })).toHaveTextContent('FA');
    await act(async () => { await i18n.changeLanguage('ar'); });
    const arabic = screen.getByRole('img', { name: 'فيصل الحربي' });
    // Arabic initials: the first letter of each name, "ال" left off the family name, kept apart so they do not join.
    expect(arabic.textContent).toBe('ف‌ح');
    await act(async () => { await i18n.changeLanguage('en'); });
  });

  it('makes Arabic initials without the article, and English initials in capitals', () => {
    expect(initialsOf('سارة القحطاني')).toBe('س‌ق');
    expect(initialsOf('هالة')).toBe('ه');
    expect(initialsOf('sara al-qahtani')).toBe('SA');
    expect(initialsOf('  ')).toBe('');
  });

  it('shows the picture of the card, or the picture that the office list gives for the person', () => {
    const { rerender } = render(<Avatar user={{ ...faisal, avatarUrl: PICTURE }} />);
    expect(screen.getByRole('img', { name: 'Faisal Al-Harbi' })).toHaveAttribute('src', PICTURE);
    rerender(
      <PicturesContext.Provider value={new Map([['usr_002', PICTURE]])}>
        <Avatar user={faisal} />
      </PicturesContext.Provider>,
    );
    expect(screen.getByRole('img', { name: 'Faisal Al-Harbi' })).toHaveAttribute('src', PICTURE);
  });

  it('never shows a picture value that is not safe, and shows the initials instead', () => {
    render(<Avatar user={{ ...faisal, avatarUrl: 'javascript:alert(1)' }} />);
    const shown = screen.getByRole('img', { name: 'Faisal Al-Harbi' });
    expect(shown.tagName).toBe('SPAN');
    expect(shown).toHaveTextContent('FA');
  });
});
