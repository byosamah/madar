import { describe, expect, it } from 'vitest';
import { bodySearchText, HIT_LINE_MAX, hitLine, holdsWords, markedParts, searchesMessages, searchWords } from './searchMatch';

describe('the words of a search (design item 16)', () => {
  it('folds the Arabic letter forms, drops tashkeel and tatweel, a first # or @, repeats, and words after the fifth', () => {
    expect(searchWords('  @أسعارُ  المـواد ')).toEqual(['اسعار', 'المواد']);
    expect(searchWords('#Riser riser RISER')).toEqual(['riser']);
    expect(searchWords('a b c d e f g')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('searches messages only when one word has 3 letters or more', () => {
    expect(searchesMessages(searchWords('ab cd'))).toBe(false);
    expect(searchesMessages(searchWords('ab riser'))).toBe(true);
    expect(searchesMessages(searchWords('رسم'))).toBe(true);
  });
  it('folds a body with each mention as @Name and one space', () => {
    expect(bodySearchText('Ask @[Reem](usr_003) about the  RISER.')).toBe('ask @reem about the riser.');
    expect(bodySearchText('مدرسةٌ في الخُبَر')).toBe('مدرسه في الخبر');
  });
  it('holds a text only when it holds every word, in any order', () => {
    expect(holdsWords('the riser moved to level 2', ['level', 'riser'])).toBe(true);
    expect(holdsWords('the riser moved', ['riser', 'roof'])).toBe(false);
  });
  it('keeps a short body whole, and starts a long one 3 words before the first hit', () => {
    expect(hitLine('Short note on the riser.', ['riser'])).toBe('Short note on the riser.');
    const line = hitLine(`${'word '.repeat(60)}the new riser size is 150 mm`, ['riser']);
    expect(line).toBe('…word the new riser size is 150 mm');
    expect(Array.from(hitLine('x '.repeat(200), ['x'])).length).toBeLessThanOrEqual(HIT_LINE_MAX);
  });
  it('marks each whole word that holds a search word, so the Arabic letters stay joined', () => {
    expect(markedParts('سعر الأسعار اليوم', ['اسعار'])).toEqual([
      { text: 'سعر ', marked: false }, { text: 'الأسعار', marked: true }, { text: ' اليوم', marked: false },
    ]);
    expect(markedParts('The Riser, again', ['riser'])).toEqual([{ text: 'The ', marked: false }, { text: 'Riser,', marked: true }, { text: ' again', marked: false }]);
  });
});
