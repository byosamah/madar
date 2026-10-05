import { useEffect, useState, useSyncExternalStore } from 'react';
import { useCall } from './runtime';
import { useAuth } from '../features/auth/useAuth';
import { applyAppearance, deviceTheme, ENV_QUERIES, readEnvironment, resolveAppearance, saveDeviceTheme } from './appearance';
import { applyLanguage, initI18n } from '../i18n';

/**
 * Applies the current user's language, theme and glass to the page, and follows device setting changes. With no session (the
 * sign-in screens of the remote build) it asks nothing: the server would only refuse session.get with 401 (TASKS.md, Wave 5
 * follow-ups, U). The prototype is always signed in.
 */
export function AppearanceSync() {
  const auth = useAuth();
  const signedIn = useSyncExternalStore(auth.subscribe, auth.status) === 'signed_in';
  const prefs = useCall('session.get', {}, { enabled: signedIn }).data?.user.preferences;
  const [env, setEnv] = useState(() => readEnvironment());

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
    applyLanguage(root, prefs.language);
    initI18n(prefs.language);
  }, [prefs, env]);

  return null;
}
