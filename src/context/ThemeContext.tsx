import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  set: (theme: Theme) => void;
}

const STORAGE_KEY = 'trizen.theme';

const ThemeContext = createContext<ThemeState>({
  theme: 'light',
  toggle: () => {},
  set: () => {},
});

function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* private mode — fall through to the OS preference */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Light/dark switching. The choice is written to `data-theme` on <html>, which
 * is what every colour variable keys off, so a change repaints the whole app
 * without any component needing to know about it.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // Keeps native form controls and scrollbars in step with the palette.
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* nothing useful to do */
    }
  }, [theme]);

  const value = useMemo<ThemeState>(
    () => ({
      theme,
      toggle: () => setTheme((current) => (current === 'light' ? 'dark' : 'light')),
      set: setTheme,
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  return useContext(ThemeContext);
}

/** Chart colours that need to change with the theme. */
export function useChartPalette() {
  const { theme } = useTheme();
  const dark = theme === 'dark';

  return useCallback(
    () => ({
      grid: dark ? '#243352' : '#e3e6ea',
      axis: dark ? '#8fa0bd' : '#93a0b1',
      series: dark
        ? ['#10b981', '#38bdf8', '#fbbf24', '#a78bfa', '#fb7185', '#34d399', '#93c5fd']
        : ['#059669', '#0D1B3D', '#f59e0b', '#8b5cf6', '#e11d48', '#0ea5e9', '#65a30d'],
    }),
    [dark],
  )();
}
