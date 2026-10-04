import { describe, expect, it } from 'vitest';
import { moveToR2, type MoveSource, type MoveTarget, type SourceObject } from './move-to-r2';

type Stored = { body: string; mimeType: string; etag: string };

function memorySource(objects: Map<string, Stored>, o: { onRead?: (key: string) => void } = {}): MoveSource {
  return {
    async list() {
      return [...objects].map(([key, v]): SourceObject => ({ key, size: v.body.length, etag: v.etag, mimeType: v.mimeType }));
    },
    async read(key) {
      o.onRead?.(key);
      const v = objects.get(key);
      return v ? { body: new TextEncoder().encode(v.body).buffer as ArrayBuffer, mimeType: v.mimeType } : null;
    },
  };
}

function memoryTarget(): MoveTarget & { objects: Map<string, { body: string; mimeType: string }>; writes: string[] } {
  const objects = new Map<string, { body: string; mimeType: string }>();
  const writes: string[] = [];
  return {
    objects,
    writes,
    async write(key, body, mimeType) {
      writes.push(key);
      objects.set(key, { body: new TextDecoder().decode(body), mimeType });
    },
    async head(key) {
      const v = objects.get(key);
      return v ? { size: v.body.length } : null;
    },
    async remove(keys) {
      for (const key of keys) objects.delete(key);
    },
  };
}

const quiet = { log: () => {} };

describe('move-to-r2 (plan 2b, point 1)', () => {
  it('copies every object with the same key and type, and checks each size on the target', async () => {
    const source = new Map<string, Stored>([
      ['prj-001/fil-001/1/file', { body: '%PDF one', mimeType: 'application/pdf', etag: 'a' }],
      ['prj-001/fil-001/1/thumb', { body: 'webp', mimeType: 'image/webp', etag: 'b' }],
      ['feedback/upl-1/file', { body: 'png', mimeType: 'image/png', etag: 'c' }],
    ]);
    const target = memoryTarget();
    const report = await moveToR2(memorySource(source), target, quiet);
    expect([...target.objects.keys()].sort()).toEqual([...source.keys()].sort());
    expect(target.objects.get('prj-001/fil-001/1/file')).toEqual({ body: '%PDF one', mimeType: 'application/pdf' });
    expect(report).toEqual({ objects: 3, bytes: 15, firstPass: 3, secondPass: 0, removedFromTarget: 0, mismatched: [] });
  });

  it('keeps the stored type from the object list, not the type of the download answer (Storage serves HTML as text/plain)', async () => {
    const source = new Map<string, Stored>([['a/b/1/file', { body: '<p>x</p>', mimeType: 'text/html', etag: '1' }]]);
    const listed = memorySource(source);
    const served: MoveSource = { list: listed.list, read: async (key) => ({ ...(await listed.read(key))!, mimeType: 'text/plain' }) };
    const target = memoryTarget();
    await moveToR2(served, target, quiet);
    expect(target.objects.get('a/b/1/file')?.mimeType).toBe('text/html');
  });

  it('copies again in the second pass the objects that changed or came during the first, and removes the ones that went', async () => {
    const source = new Map<string, Stored>([
      ['a/b/1/file', { body: 'one', mimeType: 'text/plain', etag: '1' }],
      ['a/b/2/file', { body: 'two', mimeType: 'text/plain', etag: '2' }],
      ['a/b/3/file', { body: 'three', mimeType: 'text/plain', etag: '3' }],
    ]);
    let changed = false;
    const target = memoryTarget();
    const report = await moveToR2(
      memorySource(source, {
        onRead: (key) => {
          // During the first pass, after the first copy: one object changes, one comes, one goes.
          if (key === 'a/b/2/file' && !changed) {
            changed = true;
            source.set('a/b/1/file', { body: 'one, changed', mimeType: 'text/plain', etag: '1b' });
            source.set('a/b/4/file', { body: 'four', mimeType: 'text/plain', etag: '4' });
            source.delete('a/b/3/file');
          }
        },
      }),
      target,
      quiet,
    );
    expect(target.objects.get('a/b/1/file')?.body).toBe('one, changed');
    expect(target.objects.get('a/b/4/file')?.body).toBe('four');
    expect(target.objects.has('a/b/3/file')).toBe(false);
    expect(report).toMatchObject({ objects: 3, firstPass: 2, secondPass: 2, removedFromTarget: 0, mismatched: [] });
  });

  it('removes from the target an object that the first pass copied and that went before the second pass', async () => {
    const source = new Map<string, Stored>([
      ['a/b/1/file', { body: 'one', mimeType: 'text/plain', etag: '1' }],
      ['a/b/2/file', { body: 'two', mimeType: 'text/plain', etag: '2' }],
    ]);
    const target = memoryTarget();
    const report = await moveToR2(memorySource(source, { onRead: (key) => key === 'a/b/2/file' && source.delete('a/b/1/file') }), target, quiet);
    expect([...target.objects.keys()]).toEqual(['a/b/2/file']);
    expect(report).toMatchObject({ objects: 1, firstPass: 2, secondPass: 0, removedFromTarget: 1, mismatched: [] });
  });

  it('names an object whose size on the target differs, so the run fails before the switch', async () => {
    const source = new Map<string, Stored>([['a/b/1/file', { body: 'one', mimeType: 'text/plain', etag: '1' }]]);
    const target = memoryTarget();
    const broken: MoveTarget = { ...target, write: async (key, _body, mimeType) => void target.objects.set(key, { body: 'o', mimeType }) };
    const report = await moveToR2(memorySource(source), broken, quiet);
    expect(report.mismatched).toEqual(['a/b/1/file']);
  });
});
