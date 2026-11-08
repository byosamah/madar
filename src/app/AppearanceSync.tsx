import { useEffect, useState, useSyncExternalStore } from 'react';
import { useCall } from './runtime';
import { saveBrand } from './remote/brandCache';
import { useAuth } from '../features/auth/useAuth';
import { applyAppearance, deviceTheme, ENV_QUERIES, readEnvironment, resolveAppearance, saveDeviceTheme } from './appearance';
import { applyLanguage, initI18n, withWords } from '../i18n';

/**
 * Applies the current user's language, theme and glass to the page, and follows device setting changes. With no session (the
 * sign-in screens of the remote build) it asks nothing: the server would only refuse session.get with 401 (TASKS.md, Wave 5
 * follow-ups, U). The prototype is always signed in.
 */
export function AppearanceSync() {
  const auth = useAuth();
  const signedIn = useSyncExternalStore(auth.subscribe, auth.status) === 'signed_in';
  const session = useCall('session.get', {}, { enabled: signedIn }).data;
  const prefs = session?.user.preferences;
  const enterpriseName = session?.enterprise?.name;
  const enterpriseNameAr = session?.enterprise?.nameAr;
  const [env, setEnv] = useState(() => readEnvironment());

  // The service worker names the enterprise in its fixed push line (Madar enterprises): the page leaves the two names in a Cache for it.
  useEffect(() => {
    if (enterpriseName !== undefined && enterpriseNameAr !== undefined) void saveBrand({ name: enterpriseName, nameAr: enterpriseNameAr });
  }, [enterpriseName, enterpriseNameAr]);

  useEffect(() => {
    const lists = ENV_QUERIES.map((query) => window.matchMedia(query));
    const onChange = () => setEnv(readEnvironment());
    for (const list of lists) list.addEventListener?.('change', onChange);
    return () => {
      for (const list of lists) list.removeEventListener?.('change', onChange);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    // Before sign-in (the remote build) there is no session: the page takes the theme saved on this device, else light
    // (owner, 2026-10-05, item 11). The theme of a signed-in person is saved for the screens before the next sign-in.
    applyAppearance(root, resolveAppearance(prefs ?? { theme: deviceTheme(), glass: 'frosted' }, env));
    if (!prefs) return;
    saveDeviceTheme(prefs.theme);
    // The direction and the words change together, once the words of that language are there (performance audit BND-7).
    const language = prefs.language;
    return withWords(language, () => {
      applyLanguage(root, language);
      initI18n(language);
    });
  }, [prefs, env]);

  return null;
}
