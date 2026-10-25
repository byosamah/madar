/** The hosts of the real office. Every other host (the test copy, a preview, localhost) is `test` in PostHog. */
const PRODUCTION_HOSTS: readonly string[] = ['madar.vado.sa', 'www.madar.vado.sa'];

/** The `env` property of each PostHog record (insight design, section 4). Pure and safe for the screens and for the server. */
export function insightEnv(host: string): 'production' | 'test' {
  return PRODUCTION_HOSTS.includes(host.toLowerCase()) ? 'production' : 'test';
}
