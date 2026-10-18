import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ApiErrorCode } from '../../src/api/errors';
import type { ChangeSignal as WireSignal, WireEntry } from '../../src/api/remote/wire';
import { FILE_STORE_LIMITS, fileStoreKind, type AuthAdminPort, type Deps, type FilesPort, type MailPort, type MeterPort, type SignalPort } from './ports';
import type { BatchScope, ChangeSignal, Kind, OfficeSnapshot, RunResult, ServerCall, StoryRef } from './types';
import { OFFICE_COLLECTIONS } from './types';
import { fakeDeps } from '../test/fakes/deps';

describe('the server types (type-level checks; the file compiles only when they hold)', () => {
  it('share the change signal and the story ref with the wire', () => {
    expectTypeOf<ChangeSignal>().toEqualTypeOf<WireSignal>();
    expectTypeOf<StoryRef>().toEqualTypeOf<{ id: string } | { ref: string }>();
    expectTypeOf<ChangeSignal['channel']>().toEqualTypeOf<'office' | `person:${string}`>();
  });

  it('name the kinds from State, without the session parts, plus the two narrow kinds', () => {
    expectTypeOf<'tasks'>().toExtend<Kind>();
    expectTypeOf<'projectTouched'>().toExtend<Kind>();
    expectTypeOf<'preferences'>().toExtend<Kind>();
    expectTypeOf<'session'>().not.toExtend<Kind>();
    expectTypeOf<'counters'>().not.toExtend<Kind>();
  });

  it('give a result that is an output or an error with an API error code', () => {
    const result = { ok: false, error: { code: 'unauthenticated', message: 'x' } } as RunResult;
    if (!result.ok) expectTypeOf(result.error.code).toEqualTypeOf<ApiErrorCode>();
    expectTypeOf<Extract<WireEntry, { ok: true }>['signals']>().toEqualTypeOf<ChangeSignal[] | undefined>();
  });

  it('type each server call by its contract', () => {
    expectTypeOf<Parameters<ServerCall<'files.link'>>[0]>().toHaveProperty('variant');
    expectTypeOf<Awaited<ReturnType<ServerCall<'story.start'>>>['output']>().toEqualTypeOf<{ storyId: string }>();
  });

  it('keep the office lists of the cache, read once for each batch', () => {
    expectTypeOf<OfficeSnapshot['lists']>().toHaveProperty('users');
    expectTypeOf<BatchScope['office']>().toEqualTypeOf<OfficeSnapshot | undefined>();
    expect(OFFICE_COLLECTIONS).toHaveLength(13);
    expect(OFFICE_COLLECTIONS).toContain('projectTemplates');
    expect(OFFICE_COLLECTIONS).toContain('subCompanies');
  });

  it('let the fakes stand in for every port', () => {
    const deps = fakeDeps();
    expectTypeOf(deps).toEqualTypeOf<ReturnType<typeof fakeDeps>>();
    expectTypeOf(deps).toExtend<Deps>();
    expectTypeOf(deps.files).toExtend<FilesPort>();
    expectTypeOf(deps.mail).toExtend<MailPort>();
    expectTypeOf(deps.signal).toExtend<SignalPort>();
    expectTypeOf(deps.authAdmin).toExtend<AuthAdminPort>();
    expectTypeOf(deps.meter).toExtend<MeterPort>();
  });
});

describe('the file store setting (plan 2b, point 1)', () => {
  it('starts on Supabase Storage and takes r2 only when named', () => {
    expect(fileStoreKind(undefined)).toBe('supabase');
    expect(fileStoreKind('')).toBe('supabase');
    expect(fileStoreKind('supabase')).toBe('supabase');
    expect(fileStoreKind('r2')).toBe('r2');
    expect(() => fileStoreKind('s3')).toThrow(/MADAR_FILE_STORE/);
  });

  it('has 50 MB a file and 1 GB in all on Supabase Storage, 250 MB a file on R2', () => {
    expect(FILE_STORE_LIMITS.supabase).toEqual({ maxFileBytes: 50 * 1024 * 1024, totalBytes: 1024 * 1024 * 1024 });
    expect(FILE_STORE_LIMITS.r2.maxFileBytes).toBe(250 * 1024 * 1024);
  });
});
