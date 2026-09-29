import { shell } from 'electron'

// The support server: a forum for bug reports. Only main opens it, with this fixed address: a page asks through
// overlay:report-bug and can never have another link opened.
export const SUPPORT_URL = 'https://discord.gg/jnB44eyq9e'

export const openSupport = () => {
  shell.openExternal(SUPPORT_URL).catch(() => {})
}
