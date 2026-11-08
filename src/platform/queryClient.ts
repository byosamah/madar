import { QueryClient } from '@tanstack/react-query';

/** The query client of the site: a read loads again each time a screen opens it, and nothing retries by itself (a refused call shows its reason). */
export function createSiteQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0 }, mutations: { retry: false } } });
}
