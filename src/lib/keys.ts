/**
 * The step an arrow key makes in a row of choices: 1 forward, -1 back, 0 for any other key. The end-side arrow moves forward,
 * so in Arabic ArrowLeft moves forward. With "vertical", ArrowDown also moves forward and ArrowUp back, as in a radio group.
 */
export function arrowStep(key: string, rtl: boolean, vertical = false): -1 | 0 | 1 {
  if (key === (rtl ? 'ArrowLeft' : 'ArrowRight') || (vertical && key === 'ArrowDown')) return 1;
  if (key === (rtl ? 'ArrowRight' : 'ArrowLeft') || (vertical && key === 'ArrowUp')) return -1;
  return 0;
}
