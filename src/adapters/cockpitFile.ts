import cockpit from 'cockpit'
import type { JsonStore } from '@/core/storage/appState'

const JSON_SYNTAX = { parse: (s: string) => JSON.parse(s), stringify: (o: unknown) => JSON.stringify(o, null, 2) }

export async function createCockpitStore(): Promise<JsonStore> {
  const user = await cockpit.user()
  const dir = `${user.home}/.config/inflighttv`
  await cockpit.spawn(['mkdir', '-p', dir])
  const pathOf = (name: string) => `${dir}/${name}`
  return {
    async load<T>(name: string, fallback: T): Promise<T> {
      const handle = cockpit.file<T>(pathOf(name), { syntax: JSON_SYNTAX as never })
      try {
        const content = await handle.read()
        return content ?? fallback
      } finally {
        handle.close()
      }
    },
    async save<T>(name: string, value: T): Promise<void> {
      const handle = cockpit.file<T>(pathOf(name), { syntax: JSON_SYNTAX as never })
      try {
        await handle.replace(value)
      } finally {
        handle.close()
      }
    },
  }
}
