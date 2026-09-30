/** Bars go compact once the content moves down past 64 px, and come back as soon as it moves up (spec 3.2). Small moves change nothing. */
export function nextCompact(compact: boolean, previousY: number, y: number): boolean {
  if (y <= 64) return false;
  if (y > previousY + 4) return true;
  if (y < previousY - 4) return false;
  return compact;
}
