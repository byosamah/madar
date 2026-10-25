import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '../../i18n';
import { ar, en } from '../../i18n/trees';
import { UsageDataNote, UsageDataSection } from './UsageDataSection';

// The exact words of the insight design, section 8. The owner approved them on 2026-10-25.
const EN_BODY = 'Madar records how people use it, the errors they hit, and replays of the screen, so we can fix problems and improve it. It never records what you type, chat messages or amounts. An error carries your name, so we can ask you about it. Only the office owner sees this data.';
const AR_BODY = 'يحفظ مدار كيف تستخدمه، والأخطاء التي تظهر لك، ومقاطع من شاشتك، لنصلح المشاكل ونحسّن التطبيق. لا يحفظ ما تكتبه، ولا رسائل المحادثة، ولا المبالغ. يحمل الخطأ اسمك لنسألك عنه. يرى هذه البيانات صاحب المكتب فقط.';

// The track words are merged at run time, so the type of the trees does not list them.
const words = (tree: unknown) => (tree as { insight: { title: string; body: string } }).insight;

describe('the usage data words', () => {
  it('keep the approved text in both languages', () => {
    expect(words(en).title).toBe('Usage data');
    expect(words(en).body).toBe(EN_BODY);
    expect(words(ar).title).toBe('بيانات الاستخدام');
    expect(words(ar).body).toBe(AR_BODY);
  });
});

describe('UsageDataSection', () => {
  beforeEach(() => initI18n('en'));

  it('shows the title and the one paragraph, with no control', () => {
    render(<UsageDataSection />);
    expect(screen.getByRole('heading', { level: 2, name: 'Usage data' })).toBeInTheDocument();
    expect(screen.getByText(EN_BODY)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows the Arabic words when the language is Arabic', () => {
    initI18n('ar');
    render(<UsageDataSection />);
    expect(screen.getByRole('heading', { level: 2, name: 'بيانات الاستخدام' })).toBeInTheDocument();
    expect(screen.getByText(AR_BODY)).toBeInTheDocument();
  });

  it('the note of the Me hub shows the paragraph alone', () => {
    render(<UsageDataNote />);
    expect(screen.getByText(EN_BODY)).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
  });
});
