import { describe, expect, it } from 'vitest';
import fbk067 from './fbk067.ar.json';
import fbk069 from './fbk069.ar.json';
import whatsNew from './whatsnew.ar.json';

/**
 * Arabic words of the join (owner rule: the Thmanyah style, a full short sentence and a verb in place of a noun label). A request
 * status says what the office does: «نراجعه», «نعمل عليه». The hint of the continuous switch is two full short sentences.
 */
describe('the Arabic words of the request statuses and the continuous switch', () => {
  it('names the two open statuses as verbs, and keeps the other three words', () => {
    expect(fbk067.feedback.status).toEqual({ new: 'جديد', in_review: 'نراجعه', in_progress: 'نعمل عليه', rejected: 'مرفوض', done: 'تم' });
    expect(fbk067.feedback.tabs.open).toBe('مفتوحة');
  });

  it('uses the same words in the What\'s new text of the five statuses', () => {
    const body = (whatsNew.whatsNew.items as Record<string, { body: string }>)['2026-10-23-119'].body;
    expect(body).toContain('«نراجعه»');
    expect(body).toContain('«نعمل عليه»');
    expect(body).toContain('«تم»');
    expect(body).toContain('«مرفوض»');
    expect(body).not.toContain('قيد المراجعة');
    expect(body).not.toContain('قيد التنفيذ');
  });

  it('says in the hint of the continuous switch that the project has no end date and that the work goes on', () => {
    expect(fbk069.projectForm.continuousHint).toBe('لا موعد لانتهاء المشروع. العمل فيه مستمر.');
  });
});
