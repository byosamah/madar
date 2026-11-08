/**
 * The name of the enterprise for the service worker (Madar enterprises, plan C, Task 17). The worker shows a fixed line when a push has no
 * line of its own, and the line names the enterprise: "You have something new in <name>." The worker cannot ask the server (it has no sign-in),
 * so the page writes the two names into a Cache after each session.get answer, and public/sw.js reads them. The cache holds names only: no
 * record, no person. A failing cache never breaks the page.
 */
export const BRAND_CACHE = 'madar-brand';
export const BRAND_KEY = '/__brand';

export async function saveBrand(brand: { name: string; nameAr: string }, cacheStorage: CacheStorage | undefined = globalThis.caches): Promise<void> {
  try {
    if (!cacheStorage) return;
    const cache = await cacheStorage.open(BRAND_CACHE);
    await cache.put(BRAND_KEY, new Response(JSON.stringify({ name: brand.name, nameAr: brand.nameAr }), { headers: { 'Content-Type': 'application/json' } }));
  } catch {
    // The worker then shows the old fixed line.
  }
}
