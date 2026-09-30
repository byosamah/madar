import { useEffect, useState } from 'react';
import { useCall } from './runtime';
import { applyAppearance, ENV_QUERIES, readEnvironment, resolveAppearance } from './appearance';
import { applyLanguage, initI18n } from '../i18n';

/** Applies the current user's language, theme and glass to the page, and follows device setting changes. */
export function AppearanceSync() {
  const prefs = useCall('session.get', {}).data?.user.preferences;
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
    if (!prefs) return;
    const root = document.documentElement;
    applyAppearance(root, resolveAppearance(prefs, env));
    applyLanguage(root, prefs.language);
    initI18n(prefs.language);
  }, [prefs, env]);

  return null;
}
