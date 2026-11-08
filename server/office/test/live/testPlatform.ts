import { Platform } from '../../../enterprise/platform/object';

/** The platform object of the live suites: the production class, with a read that gives the rows it read. */
export class TestPlatform extends Platform {
  /** A select for a test to read a table of the platform object. Any other statement throws. */
  peek(text: string): Record<string, unknown>[] {
    if (!/^\s*select\b/i.test(text)) throw new Error('peek runs a select only.');
    return this.host.exec(text, []).rows;
  }

  async resolveRows(email: string): Promise<{ ent: string | null; rows: number }> {
    const before = this.host.totals.rowsRead;
    const found = await this.resolveEmail({ email });
    return { ent: found?.ent ?? null, rows: this.host.totals.rowsRead - before };
  }
}
