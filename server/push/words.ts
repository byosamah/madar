import i18next, { type TFunction } from 'i18next';
import type { Language } from '../../src/api/contract/entities';
import { mergeWords } from '../../src/i18n/mergeWords';
import { inbox as baseInboxAr } from '../../src/i18n/ar.json';
import { inbox as baseInboxEn } from '../../src/i18n/en.json';
import { notices as chatmsgNoticesAr } from '../../src/i18n/real/chatmsg.ar.json';
import { notices as chatmsgNoticesEn } from '../../src/i18n/real/chatmsg.en.json';
import { inbox as batchbInboxAr } from '../../src/i18n/real/batchb.ar.json';
import { inbox as batchbInboxEn } from '../../src/i18n/real/batchb.en.json';
import { inbox as daftraInboxAr } from '../../src/i18n/real/daftra.ar.json';
import { inbox as daftraInboxEn } from '../../src/i18n/real/daftra.en.json';
import { inbox as fbnoticesInboxAr } from '../../src/i18n/real/fbnotices.ar.json';
import { inbox as fbnoticesInboxEn } from '../../src/i18n/real/fbnotices.en.json';
import { inbox as inboxInboxAr } from '../../src/i18n/real/inbox.ar.json';
import { inbox as inboxInboxEn } from '../../src/i18n/real/inbox.en.json';
import { inbox as meetingsInboxAr } from '../../src/i18n/real/meetings.ar.json';
import { inbox as meetingsInboxEn } from '../../src/i18n/real/meetings.en.json';
import { push as pushAr } from '../../src/i18n/real/push.ar.json';
import { push as pushEn } from '../../src/i18n/real/push.en.json';
import { inbox as teamaInboxAr } from '../../src/i18n/real/teama.ar.json';
import { inbox as teamaInboxEn } from '../../src/i18n/real/teama.en.json';
import { inbox as teamhelpInboxAr } from '../../src/i18n/real/teamhelp.ar.json';
import { inbox as teamhelpInboxEn } from '../../src/i18n/real/teamhelp.en.json';

/**
 * The words of the push line (owner, 2026-10-21): the bell sentences (inbox.*, notices.replied*) and the push words, in an i18next
 * instance of the server's own, as server/mail/templates/words.ts does for the mail. It imports only the "inbox", "notices" and
 * "push" parts of each word file by name, so the bundle keeps those parts and not the whole files (the api bundle has a bound,
 * server/entries/bundles.test.ts). words.test.ts checks that the "inbox" words here are all the "inbox" words of the screens: a track
 * that adds a bell sentence in a new file adds that file here too.
 */
const tree = (inbox: object[], notices: object, push: object, lang: Language) => mergeWords(
  { inbox: {}, notices: {}, push: {} },
  [
    ...inbox.map((words, i) => ({ file: `inbox ${i} (${lang})`, words: { inbox: words } })),
    { file: `chatmsg (${lang})`, words: { notices } },
    { file: `push (${lang})`, words: { push } },
  ],
);

export const PUSH_WORDS = {
  en: tree([baseInboxEn, inboxInboxEn, meetingsInboxEn, teamaInboxEn, teamhelpInboxEn, fbnoticesInboxEn, batchbInboxEn, daftraInboxEn], chatmsgNoticesEn, pushEn, 'en'),
  ar: tree([baseInboxAr, inboxInboxAr, meetingsInboxAr, teamaInboxAr, teamhelpInboxAr, fbnoticesInboxAr, batchbInboxAr, daftraInboxAr], chatmsgNoticesAr, pushAr, 'ar'),
};

const instance = i18next.createInstance();
void instance.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { translation: PUSH_WORDS.en }, ar: { translation: PUSH_WORDS.ar } },
  interpolation: { escapeValue: false },
  initAsync: false,
});

/** The word function of one language. i18next picks the Arabic plural forms from "count" and the "_female" forms from "context". */
export function pushWords(lang: Language): TFunction {
  return instance.getFixedT(lang);
}
