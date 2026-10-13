import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { MantineProvider, v8CssVariablesResolver } from '@mantine/core';
import {
  ACCENTS,
  ACCENT_STORAGE_KEY,
  buildTheme,
  DEFAULT_ACCENT,
  DEFAULT_SKIN,
  SKINS,
  SKIN_STORAGE_KEY,
  type AccentColor,
  type SkinId,
} from '../theme';

/**
 * Runtime home of the app's appearance choices. Color scheme (light/dark/auto)
 * is already owned and persisted by Mantine (`useMantineColorScheme`); this
 * provider adds the two axes it doesn't: the brand **accent** and the **skin**.
 * Both feed a freshly built theme into MantineProvider so `--mantine-*` tokens
 * repoint app-wide, and the skin is mirrored onto `data-skin` on <html> so its
 * scoped stylesheet (src/skins/*.css) can paint the chrome.
 */
interface AppearanceContextValue {
  accent: AccentColor;
  setAccent: (accent: AccentColor) => void;
  accents: typeof ACCENTS;
  skin: SkinId;
  setSkin: (skin: SkinId) => void;
  skins: typeof SKINS;
  /** The active skin's SKINS row — branch on these traits, never on `skin`. */
  skinTraits: (typeof SKINS)[number];
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

/** Read a persisted value, ignoring anything not in the given registry. */
function readStored<T extends string>(key: string, allowed: readonly { value: T }[], fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  const stored = localStorage.getItem(key);
  return allowed.some((o) => o.value === stored) ? (stored as T) : fallback;
}

function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private-mode / storage-disabled: keep the in-memory choice, skip persistence.
  }
}

/**
 * Wraps the app in a MantineProvider whose theme tracks the chosen accent + skin,
 * and exposes those choices via `useAppearance()`. Reading localStorage in the
 * initial state means stored choices are applied on first React render; a tiny
 * inline bootstrap script in index.html sets `data-skin` even earlier (before
 * any JS module loads), so a stored non-Modern skin doesn't flash Modern chrome
 * for one frame. The effect below keeps `data-skin` in sync on live skin switches.
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [accent, setAccentState] = useState<AccentColor>(() => readStored(ACCENT_STORAGE_KEY, ACCENTS, DEFAULT_ACCENT));
  const [skin, setSkinState] = useState<SkinId>(() => readStored(SKIN_STORAGE_KEY, SKINS, DEFAULT_SKIN));

  const setAccent = useCallback((next: AccentColor) => {
    setAccentState(next);
    persist(ACCENT_STORAGE_KEY, next);
  }, []);

  const setSkin = useCallback((next: SkinId) => {
    setSkinState(next);
    persist(SKIN_STORAGE_KEY, next);
  }, []);

  // The skin's chrome CSS is keyed off this attribute (covers portals too, since
  // they mount under <body>, which is inside <html>).
  useEffect(() => {
    document.documentElement.dataset.skin = skin;
  }, [skin]);

  const theme = useMemo(() => buildTheme(accent, skin), [accent, skin]);
  const skinTraits = useMemo(() => SKINS.find((s) => s.value === skin) ?? SKINS[0], [skin]);
  const value = useMemo<AppearanceContextValue>(
    () => ({ accent, setAccent, accents: ACCENTS, skin, setSkin, skins: SKINS, skinTraits }),
    [accent, setAccent, skin, setSkin, skinTraits],
  );

  return (
    <AppearanceContext.Provider value={value}>
      {/* Mantine 9 made the `light` variant solid (dark scheme: opaque fill + near-white text), which turned every
          colored dark-mode value white; the v8 resolver keeps the tinted fills + colored text the skins and their
          contrast audit were built on. It injects after our CSS, so skin token blocks need (0,3,0) to win. */}
      <MantineProvider theme={theme} defaultColorScheme="auto" cssVariablesResolver={v8CssVariablesResolver}>
        {children}
      </MantineProvider>
    </AppearanceContext.Provider>
  );
}

/** Access and change the current accent + skin. Must be used under <AppThemeProvider>. */
export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error('useAppearance must be used within <AppThemeProvider>');
  return ctx;
}
