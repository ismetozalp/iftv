// Pure theme resolution. No imports, no DOM — keep this file trivially unit-testable.

export type ThemeMode = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

export const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark']

export function resolveTheme(mode: ThemeMode, cockpitTheme: Theme | null, prefersDark: boolean): Theme {
  if (mode === 'light') return 'light'
  if (mode === 'dark') return 'dark'
  return cockpitTheme ?? (prefersDark ? 'dark' : 'light')
}
