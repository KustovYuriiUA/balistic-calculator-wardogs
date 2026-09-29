import { ipcRenderer } from 'electron'

import type { PageEvents, PagePushes, PageRequests } from '@/shared/ipc'

// Typed wrappers over ipcRenderer: a channel and its payload come from the contract, so a page cannot send what
// main does not expect. The raw ipcRenderer never reaches a page.

export function send<C extends keyof PageEvents>(channel: C, ...args: PageEvents[C]) {
  ipcRenderer.send(channel, ...args)
}

export function request<C extends keyof PageRequests>(
  channel: C,
  ...args: PageRequests[C][0]
): Promise<PageRequests[C][1]> {
  return ipcRenderer.invoke(channel, ...args)
}

export function listen<C extends keyof PagePushes>(
  channel: C,
  listener: (...args: PagePushes[C]) => void,
) {
  ipcRenderer.on(channel, (_event, ...args) => listener(...(args as PagePushes[C])))
}
