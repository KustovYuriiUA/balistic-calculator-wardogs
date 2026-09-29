import { useEffect, useState } from 'react'

import { t } from '@/shared/i18n'
import type { UpdateAction, UpdateState } from '@/shared/ipc'
import { useUpdateState } from '@/store'

interface PillView {
  text: string
  action: UpdateAction | null
  title: string
}

function pillView(u: UpdateState, isNotice: boolean): PillView | null {
  const v = u.version ?? ''
  const view = (text: string, action: UpdateAction | null, title: string) => ({
    text,
    action,
    title,
  })
  switch (u.state) {
    case 'downloading': return view(`↓ ${v} · ${u.progress ?? 0}%`, null, t('upd.downloading'))
    case 'ready': return view(t('upd.ready', {
      v,
    }), 'restart', t('upd.readyTitle'))
    case 'manual': return view(t('upd.manual', {
      v,
    }), 'open', t('upd.manualTitle'))
    case 'checking': return u.isManual ? view(t('upd.checking'), null, t('upd.checkingTitle')) : null
    case 'latest': return isNotice
      ? view(t('upd.latest', {
        v: u.current,
      }), null, t('upd.latestTitle'))
      : null
    case 'error': return isNotice ? view(t('upd.offline'), null, u.message ?? '') : null
    default: return null
  }
}

/** Download progress, restart when ready, a link when a full download is needed; a check asked for by hand shows
 * its result for a moment. */
export function UpdatePill() {
  const update = useUpdateState()
  const [hiddenFor, setHiddenFor] = useState<UpdateState | null>(null)
  const isNotice = Boolean(update?.isManual && (update.state === 'latest' || update.state === 'error'))

  useEffect(() => {
    if (!isNotice) return
    const timer = setTimeout(() => setHiddenFor(update), 5000)
    return () => clearTimeout(timer)
  }, [update, isNotice])

  const view = update && hiddenFor !== update ? pillView(update, isNotice) : null
  if (!view) return null
  const isReady = update?.state === 'ready' || update?.state === 'manual'
  return (
    <button
      id="update-pill"
      className={'update-pill' + (isReady ? ' ready' : '')}
      type="button"
      title={view.title}
      data-action={view.action ?? undefined}
      disabled={!view.action}
      onClick={() => view.action && window.overlay?.update(view.action)}
    >
      {view.text}
    </button>
  )
}
