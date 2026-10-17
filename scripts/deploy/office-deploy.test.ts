import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The text of the office branches (exit wave 4). scripts/deploy/deploy.test.ts runs the same scripts with stub CLIs. */
const text = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

describe('the deploy of an office copy (exit wave 4)', () => {
  it('all.sh leaves out the Supabase steps for an office copy, and keeps every step for the other words', () => {
    const all = text('all.sh');
    expect(all).toMatch(/host="\$\(node scripts\/deploy\/serverHost\.ts host "\$TARGET"\)"/);
    const office = all.slice(all.indexOf('if [ "$host" = office ]; then'), all.indexOf('\nelse'));
    expect(office).toContain('"$BIN/tsx" "$DIR/secrets.ts" "$TARGET" --office');
    expect(office).toContain('"$DIR/worker.sh" "$TARGET"');
    // The echo line names the three steps that stay out, so the check looks for the calls.
    for (const step of ['"$DIR/db.sh"', '"$DIR/config.sh"', '"$DIR/functions.sh"']) expect(office).not.toContain(step);
    const rest = all.slice(all.indexOf('\nelse'));
    for (const step of ['"$DIR/db.sh" "$TARGET"', '"$DIR/config.sh" "$TARGET"', '"$DIR/functions.sh" "$TARGET"', '"$DIR/worker.sh" "$TARGET" --prebuilt']) expect(rest).toContain(step);
  });

  it('worker.sh deploys an office copy with MADAR_DATA = office, and no other copy with it', () => {
    const worker = text('worker.sh');
    expect(worker).toContain('vars=(--var MADAR_DATA:office)');
    expect(worker).toContain('${vars[@]+"${vars[@]}"}');
  });

  it('checks.sh knows the office header and the office health', () => {
    const checks = text('checks.sh');
    expect(checks).toContain('office:office\\;colo=*) return 0 ;;');
    expect(checks).toContain('*\'"office":{"schema":\'*');
  });
});
