import { expect, it } from 'vitest'
import { resolveTheme } from './theme'

it('light/dark modes force that theme regardless of ambient', () => {
  expect(resolveTheme('light', 'dark', true)).toBe('light')
  expect(resolveTheme('dark', 'light', false)).toBe('dark')
})
it('system follows Cockpit theme when the shell set one', () => {
  expect(resolveTheme('system', 'dark', false)).toBe('dark')
  expect(resolveTheme('system', 'light', true)).toBe('light')
})
it('system falls back to OS prefers-color-scheme when Cockpit set nothing', () => {
  expect(resolveTheme('system', null, true)).toBe('dark')
  expect(resolveTheme('system', null, false)).toBe('light')
})
