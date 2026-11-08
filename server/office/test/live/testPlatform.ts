import { Platform } from '../../../enterprise/platform/object';

/** The platform object of the live suites: the production class, with a read that gives the rows it read. */
export class TestPlatform extends Platform {
  async resolveRows(email: string): Promise<{ ent: string | null; rows: number }> {
    const before = this.host.totals.rowsRead;
    const found = await this.resolveEmail({ email });
    return { ent: found?.ent ?? null, rows: this.host.totals.rowsRead - before };
  }
}
