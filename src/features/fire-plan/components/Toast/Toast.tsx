import { useEffect } from 'react'

import { t } from '@/shared/i18n'

import { useFirePlanActions, useToast } from '../../stores/firePlan'

/** A short message over the window; an undoable one stays longer and offers Ctrl+Z. */
export function Toast() {
  const toast = useToast()
  const { hideToast, undo } = useFirePlanActions()
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(hideToast, toast.isUndoable ? 6000 : 2200)
    return () => clearTimeout(timer)
  }, [toast, hideToast])
  return (
    <div id="toast" className="toast" role="status" hidden={!toast}>
      <span id="toast-text">{toast?.text}</span>
      <button id="toast-undo" type="button" hidden={!toast?.isUndoable} onClick={undo} dangerouslySetInnerHTML={{
        __html: t('toast.undo'),
      }} />
    </div>
  )
}
