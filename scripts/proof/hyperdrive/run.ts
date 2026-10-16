// The Mac side of the Hyperdrive probe on madar-test (proof.md, "Hyperdrive probe on madar-test (2026-10-16)").
//   PROBE_SECRET_FILE=<file> node --import tsx scripts/proof/hyperdrive/run.ts <step> [rounds]   (the sandbox must be off)
// steps: cases (a to f on both poolers), cross (the lock across two HTTP requests), placement (g), e2e (h, with curl),
// sample <rounds> <case> (one case many times: passes, hangs, and the statement that hung).
// The secret stays in its file (mode 600, outside the repo). curl reads the header from a file next to it, so the secret is
// never on a command line. The output is JSON with no secret.
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { median, redact } from './lib.ts';

const PROBE = 'https://madar-probe.vado-sa.workers.dev';
const EDGE = 'https://madar-probe-edge.vado-sa.workers.dev';
/** PROBE_DBS=session (or tx) limits a run to one pooler. */
const DBS = (process.env.PROBE_DBS ?? 'session,tx').split(',').filter((db) => db === 'session' || db === 'tx');
const run = promisify(execFile);

const secretFile = process.env.PROBE_SECRET_FILE;
if (!secretFile) throw new Error('PROBE_SECRET_FILE is missing: name the file that holds the probe secret.');
const secret = readFileSync(secretFile, 'utf8').trim();
const headerFile = join(dirname(secretFile), 'probe-header.txt');
writeFileSync(headerFile, `x-probe-secret: ${secret}\n`, { mode: 0o600 });

const print = (data: unknown) => console.log(redact(JSON.stringify(data, null, 2), [secret]));

/** One GET with a 40 s limit on the Mac side. A plan limit (such as error 1102) comes back as a page, so the text is kept. */
async function get(base: string, path: string) {
  const t0 = performance.now();
  try {
    const res = await fetch(`${base}${path}`, { headers: { 'x-probe-secret': secret }, signal: AbortSignal.timeout(40_000) });
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = { notJson: text.slice(0, 300) };
    }
    return { status: res.status, macMs: Math.round(performance.now() - t0), cfPlacement: res.headers.get('cf-placement'), cfRay: res.headers.get('cf-ray'), body };
  } catch (error) {
    return { status: 0, macMs: Math.round(performance.now() - t0), error: error instanceof Error ? error.message : String(error) };
  }
}

async function cases() {
  const out: Record<string, unknown> = {};
  for (const db of DBS) {
    for (const name of ['param', 'start', 'lock', 'cache', 'notice', 'realtime', 'timing']) out[`${name}.${db}`] = await get(PROBE, `/${name}?db=${db}`);
  }
  print({ step: 'cases', out });
}

async function cross(rounds: number) {
  const out: unknown[] = [];
  for (const db of DBS) {
    for (let i = 0; i < rounds; i += 1) {
      const key = 1 + Math.floor(Math.random() * 2_000_000_000);
      const [a, b] = await Promise.all([get(PROBE, `/lockpart?db=${db}&role=A&key=${key}`), get(PROBE, `/lockpart?db=${db}&role=B&key=${key}`)]);
      const ra = (a.body as { result?: { commitAt?: number; oneTransaction?: boolean; holdsOwnLock?: boolean }; isolate?: string } | undefined) ?? {};
      const rb = (b.body as { result?: { gotAt?: number; waitMs?: number }; isolate?: string } | undefined) ?? {};
      const waitMs = rb.result?.waitMs ?? -1;
      const gotAfterCommitMs = (rb.result?.gotAt ?? 0) - (ra.result?.commitAt ?? 0);
      out.push({
        db,
        round: i + 1,
        pass: ra.result?.oneTransaction === true && ra.result?.holdsOwnLock === true && waitMs >= 900 && waitMs <= 3000 && gotAfterCommitMs >= -50,
        aOneTransaction: ra.result?.oneTransaction,
        aHoldsOwnLock: ra.result?.holdsOwnLock,
        bWaitMs: waitMs,
        bGotAfterACommitMs: gotAfterCommitMs,
        twoIsolates: ra.isolate !== undefined && ra.isolate !== rb.isolate,
        a,
        b,
      });
    }
  }
  print({ step: 'cross', out });
}

async function placement(rounds: number) {
  const out: unknown[] = [];
  for (let i = 0; i < rounds; i += 1) {
    const direct = await get(PROBE, '/whoami');
    const viaEdge = await get(EDGE, '/whoami');
    const d = direct.body as { colo?: string; runColo?: string; cfPlacement?: string | null };
    const e = viaEdge.body as { edgeColo?: string; innerPlacementHeader?: string; inner?: { colo?: string; runColo?: string; cfPlacement?: string | null } };
    out.push({
      round: i + 1,
      direct: { status: direct.status, macMs: direct.macMs, requestColo: d?.colo, runColo: d?.runColo, placementRequestHeader: d?.cfPlacement, placementAnswerHeader: direct.cfPlacement },
      binding: { status: viaEdge.status, macMs: viaEdge.macMs, edgeColo: e?.edgeColo, probeRequestColo: e?.inner?.colo, probeRunColo: e?.inner?.runColo, placementRequestHeader: e?.inner?.cfPlacement, placementAnswerHeader: e?.innerPlacementHeader },
    });
  }
  print({ step: 'placement', out });
}

async function e2e(rounds: number) {
  const out: Record<string, unknown> = {};
  for (const db of DBS) {
    const starts: number[] = [];
    const totals: number[] = [];
    const afterTls: number[] = [];
    const inside: unknown[] = [];
    // Cold: a new curl process for each round, so each round pays DNS, TCP and TLS, as a first request does.
    for (let i = 0; i < rounds; i += 1) {
      const { stdout } = await run('curl', ['-s', '-H', `@${headerFile}`, '-w', '\n%{http_code} %{time_starttransfer} %{time_total} %{time_appconnect}', `${EDGE}/tx5?db=${db}`], { timeout: 40_000 });
      const lines = stdout.trim().split('\n');
      const [code, start, total, tls] = lines[lines.length - 1].split(' ');
      starts.push(Math.round(Number(start) * 1000));
      totals.push(Math.round(Number(total) * 1000));
      afterTls.push(Math.round((Number(start) - Number(tls)) * 1000));
      try {
        const body = JSON.parse(lines.slice(0, -1).join('\n')) as { edgeColo?: string; edgeMs?: number; inner?: { ms?: number; result?: unknown; error?: unknown } };
        inside.push({ code, edgeColo: body.edgeColo, edgeMs: body.edgeMs, probeMs: body.inner?.ms, result: body.inner?.result, error: body.inner?.error });
      } catch {
        inside.push({ code, notJson: lines.slice(0, -1).join('\n').slice(0, 300) });
      }
    }
    // Warm: one curl process for all rounds, so the rounds after the first reuse one connection, as the open screens do.
    const warmArgs = ['-s', '-H', `@${headerFile}`, '-w', '%{http_code} %{time_starttransfer} %{time_total} %{time_appconnect}\n'];
    for (let i = 0; i < rounds + 1; i += 1) warmArgs.push('-o', '/dev/null', `${EDGE}/tx5?db=${db}`);
    const warm = (await run('curl', warmArgs, { timeout: 120_000 })).stdout.trim().split('\n').slice(1).map((line) => {
      const [code, start, total] = line.split(' ');
      return { code, startTransferMs: Math.round(Number(start) * 1000), totalMs: Math.round(Number(total) * 1000) };
    });
    out[db] = {
      rounds,
      cold: {
        startTransferMs: { median: median(starts), all: starts },
        totalMs: { median: median(totals), all: totals },
        afterTlsMs: { median: median(afterTls), all: afterTls },
      },
      warm: {
        startTransferMs: { median: median(warm.map((w) => w.startTransferMs)), all: warm.map((w) => w.startTransferMs) },
        totalMs: { median: median(warm.map((w) => w.totalMs)), all: warm.map((w) => w.totalMs) },
        codes: warm.map((w) => w.code),
      },
      inside,
    };
  }
  print({ step: 'e2e', out });
}

/** One case, many times in a row on both poolers: how often it passes, how often it hangs, and which statement hung. */
async function sample(name: string, rounds: number) {
  const out: Record<string, unknown> = {};
  for (const db of DBS) {
    const rows: unknown[] = [];
    for (let i = 0; i < rounds; i += 1) {
      const r = await get(PROBE, `/${name}?db=${db}`);
      const body = (r.body ?? {}) as { ms?: number; isolate?: string; error?: { message?: string }; pending?: unknown; result?: { pass?: boolean; ok?: boolean } };
      const macError = 'error' in r ? r.error : undefined;
      const ok = r.status === 200 && body.error === undefined && (body.result?.pass ?? body.result?.ok) !== false;
      rows.push({ status: r.status, ms: body.ms, isolate: body.isolate?.slice(0, 8), ok, error: body.error?.message ?? macError, pending: body.pending });
    }
    const list = rows as { ok: boolean; error?: string }[];
    out[db] = { rounds, ok: list.filter((x) => x.ok).length, timeouts: list.filter((x) => (x.error ?? '').includes('timeout')).length, rows };
  }
  print({ step: 'sample', case: name, out });
}

const step = process.argv[2];
const rounds = Number(process.argv[3] ?? '') || undefined;
if (step === 'cases') await cases();
else if (step === 'cross') await cross(rounds ?? 3);
else if (step === 'placement') await placement(rounds ?? 5);
else if (step === 'e2e') await e2e(rounds ?? 10);
else if (step === 'sample') await sample(process.argv[4] ?? 'param', rounds ?? 10);
else throw new Error('steps: cases cross placement e2e sample');
