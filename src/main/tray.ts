import { app, Menu, Tray, type NativeImage } from 'electron'

import { updateAction } from '@/features/updates/main/updater'
import {
  getLanguage, LANGUAGE_IDS, LANGUAGES, t, type Language,
} from '@/shared/i18n'
import type { UpdateState } from '@/shared/ipc'

// Every action the window offers is reachable here too: the window may be hidden or click-through.
export interface TrayActions {
  toggleMarking: () => void
  showKeyboard: () => void
  hide: () => void
  pickArea: () => void
  snapshot: () => void
  setLanguage: (language: Language) => void
  reveal: () => void
}

export interface AppTray {
  refresh: (update: UpdateState) => void
}

export function createTray(icon: NativeImage, version: string, actions: TrayActions): AppTray {
  const tray = new Tray(icon)
  tray.on('double-click', actions.toggleMarking)

  function refresh(update: UpdateState) {
    tray.setToolTip(t('tray.tooltip', {
      v: version,
    }))
    const updateItems = update.state === 'ready'
      ? [{
        label: t('tray.update', {
          v: update.version ?? '',
        }),
        click: () => updateAction('restart'),
      }]
      : update.state === 'manual'
        ? [{
          label: t('tray.download', {
            v: update.version ?? '',
          }),
          click: () => updateAction('open'),
        }]
        : []
    const languages = LANGUAGE_IDS.map((language) => ({
      label: LANGUAGES[language],
      type: 'radio' as const,
      checked: language === getLanguage(),
      click: () => actions.setLanguage(language),
    }))
    const isChecking = update.state === 'checking' || update.state === 'downloading'
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: t('tray.markers'),
        click: actions.toggleMarking,
      },
      {
        label: t('tray.keyboard'),
        click: actions.showKeyboard,
      },
      {
        label: t('tray.hide'),
        click: actions.hide,
      },
      {
        type: 'separator',
      },
      {
        label: t('menu.pickArea'),
        click: actions.pickArea,
      },
      {
        label: t('menu.snapshot'),
        click: actions.snapshot,
      },
      {
        label: t('bar.language'),
        submenu: languages,
      },
      {
        type: 'separator',
      },
      {
        label: t('tray.version', {
          v: version,
        }),
        enabled: false,
      },
      ...updateItems,
      {
        label: t('tray.check'),
        enabled: update.isEnabled && !isChecking,
        click: () => {
          updateAction('check')
          actions.reveal()
        },
      },
      {
        label: t('tray.auto'),
        type: 'checkbox',
        checked: update.isAuto,
        enabled: update.isEnabled,
        click: () => updateAction('toggle-auto'),
      },
      {
        type: 'separator',
      },
      {
        label: t('tray.quit'),
        click: () => app.quit(),
      },
    ]))
  }

  return {
    refresh,
  }
}
