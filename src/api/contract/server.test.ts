import { describe, expect, it } from 'vitest';
import { serverContracts } from './server';

/**
 * The file type of an upload is one plain type/subtype (F1 review). A type with a comma or parameters could pass a "starts with
 * image/" check and still name another type to a store or a browser, so the contract refuses it before anything is signed.
 */
describe('the file types of the upload calls', () => {
  const start = (mimeType: string) => serverContracts['files.uploadStart'].input.safeParse({ projectId: 'prj_001', name: 'a', size: 1, mimeType }).success;
  const shot = (mimeType: string) => serverContracts['feedback.uploadStart'].input.safeParse({ screenshots: [{ size: 1, mimeType }] }).success;
  const thumb = (mimeType: string) =>
    serverContracts['files.uploadStart'].input.safeParse({ projectId: 'prj_001', name: 'a.png', size: 1, mimeType: 'image/png', thumb: { size: 1, mimeType } }).success;

  it('accept plain types', () => {
    for (const type of ['application/pdf', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'model/x.rvt+zip']) expect(start(type), type).toBe(true);
    expect(shot('image/webp')).toBe(true);
    expect(thumb('image/webp')).toBe(true);
  });

  it('refuse a type with a comma, parameters, spaces or no subtype', () => {
    for (const type of ['image/png, text/html', 'image/png;x=1, text/html', 'text/html; charset=utf-8', 'x', 'image/', ' image/png']) {
      expect(start(type), type).toBe(false);
      expect(shot(type), type).toBe(false);
      expect(thumb(type), type).toBe(false);
    }
  });
});
