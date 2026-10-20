import { FILE_STORE_LIMITS, type Config, type Db, type Deps, type LogFields, type Logger } from '../../core/ports';
import { fakeAuthAdmin, type FakeAuthAdmin } from './authAdmin';
import { fixedClock, type FixedClock } from './clock';
import { noDb } from './db-none';
import { fakeFiles, type FakeFiles } from './files';
import { fakeMail, type FakeMail } from './mail';
import { recordingSignals, type RecordingSignals } from './signal';

export type LogLine = { level: 'info' | 'warn' | 'error'; message: string; fields?: LogFields };

export type FakeDeps = Omit<Deps, 'clock' | 'files' | 'mail' | 'signal' | 'authAdmin'> & {
  clock: FixedClock;
  files: FakeFiles;
  mail: FakeMail;
  signal: RecordingSignals;
  authAdmin: FakeAuthAdmin;
  logs: LogLine[];
};

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    lockKey: 1,
    appUrl: 'http://127.0.0.1:5173',
    apiUrl: 'http://127.0.0.1:54321/functions/v1/api',
    mcpUrl: 'http://127.0.0.1:54321/functions/v1/mcp',
    supabaseUrl: 'http://127.0.0.1:54321',
    mailFrom: 'Madar <notices@madar.test>',
    minClientBuild: '0',
    allowedOrigins: ['http://127.0.0.1:5173'],
    region: 'eu-central-1',
    forwardRegion: 'eu-central-1',
    fileStore: 'supabase',
    limits: { maxFileBytes: FILE_STORE_LIMITS.supabase.maxFileBytes, filesTotalBytes: FILE_STORE_LIMITS.supabase.totalBytes },
    ...overrides,
  };
}

/** A full set of fakes. A test passes the real Db of the harness, or keeps noDb when it needs no SQL. */
export function fakeDeps(o: { db?: Db; config?: Partial<Config> } = {}): FakeDeps {
  const logs: LogLine[] = [];
  const line = (level: LogLine['level']) => (message: string, fields?: LogFields) => {
    logs.push(fields === undefined ? { level, message } : { level, message, fields });
  };
  const log: Logger = { info: line('info'), warn: line('warn'), error: line('error') };
  const config = testConfig(o.config);
  return {
    db: o.db ?? noDb,
    clock: fixedClock(),
    files: fakeFiles({ kind: config.fileStore, maxFileBytes: config.limits.maxFileBytes }),
    mail: fakeMail(),
    signal: recordingSignals(),
    authAdmin: fakeAuthAdmin(),
    config,
    log,
    logs,
  };
}
