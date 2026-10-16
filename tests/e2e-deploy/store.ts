/**
 * The file store that the walk sees (owner, 2026-10-16): Supabase Storage before the switch, R2 after it. Pure, so
 * scripts/e2e-deploy-helpers.test.ts checks it with no browser.
 */

export type WalkStore = 'supabase' | 'r2';

/** The R2 EU endpoint of an account (server/files/r2.ts signs only there). */
const R2_HOST = /^[0-9a-f]{32}\.eu\.r2\.cloudflarestorage\.com$/;
/** The R2 bucket of the test copy: the walk never reads the production bucket. */
const R2_TEST_PATH = '/madar-files-test/';

/** The store of a signed upload PUT: the Storage upload sign path, or the R2 EU endpoint. Any other URL gives null. */
export function storeOfUpload(url: string): WalkStore | null {
  const parsed = new URL(url);
  if (R2_HOST.test(parsed.hostname)) return 'r2';
  if (parsed.pathname.includes('/storage/v1/object/upload/sign/')) return 'supabase';
  return null;
}

/**
 * True for a signed download link: Storage (/storage/v1/object/sign/), or the R2 test bucket with a signature in the query.
 * The walk takes one as the last proof of the PDF download, when the browser gives no download and no new tab.
 */
export function isSignedFileLink(url: string): boolean {
  const parsed = new URL(url);
  if (parsed.pathname.includes('/storage/v1/object/sign/')) return true;
  return R2_HOST.test(parsed.hostname) && parsed.pathname.startsWith(R2_TEST_PATH) && parsed.searchParams.has('X-Amz-Signature');
}
