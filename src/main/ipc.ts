import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'

import type { PageEvents, PagePushes, PageRequests } from '@/shared/ipc'

// Main's side of the IPC contract. Channel names come from the contract; payloads arrive as unknown, since any
// page may send anything: every handler checks the sender first and validates what it reads.

export function onEvent<C extends keyof PageEvents>(
  channel: C,
  handler: (event: IpcMainEvent, ...args: unknown[]) => void,
) {
  ipcMain.on(channel, handler)
}

export function onRequest<C extends keyof PageRequests>(
  channel: C,
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) =>
    Promise<PageRequests[C][1]> | PageRequests[C][1],
) {
  ipcMain.handle(channel, handler)
}

export function push<C extends keyof PagePushes>(
  window: BrowserWindow | null | undefined,
  channel: C,
  ...args: PagePushes[C]
) {
  if (window && !window.isDestroyed()) window.webContents.send(channel, ...args)
}

/** The same guard for every window this app creates: no menu, no new windows, no navigation. */
export function lockDown(window: BrowserWindow) {
  window.setMenu(null)
  window.webContents.setWindowOpenHandler(() => ({
    action: 'deny',
  }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
}
