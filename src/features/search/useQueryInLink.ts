import { useEffect, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router';

/**
 * Writes the search text into the link (?q=), so Back from a result shows the same search again (audit PER-14). The entry is
 * replaced, so Back does not step through every search.
 *
 * It writes only while the link is still the search screen's own, and only when the text changes. When a result opens, the link
 * moves first and the search screen stays on screen for a moment: a write then put "?q=" on the new page and dropped its own
 * parameters, so a file found by Search opened its project without the file (2026-10-04). The setter of useSearchParams
 * changes with every link, so it is not a reason to write again.
 */
export function useQueryInLink(query: string): void {
  const [, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const own = useRef(pathname);
  const written = useRef<string | null>(null);
  useEffect(() => {
    if (pathname !== own.current || written.current === query) return;
    written.current = query;
    setParams(query ? { q: query } : {}, { replace: true });
  }, [query, pathname, setParams]);
}
