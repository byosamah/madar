import { lazyOverlay } from '../../app/lazyOverlay';

/**
 * The weekly card of Home (fbk_088, owner 2026-11-08) loads in its own chunk, because Home is in the first load and the card is not.
 * Home starts the import with its first reads (`warmWeekCard`), so the card finds its code when the answers come.
 */
const card = lazyOverlay(() => import('./WeekCard').then((m) => m.WeekCard));

export const WeekCardSlot = card.Overlay;
export const warmWeekCard = card.warm;
