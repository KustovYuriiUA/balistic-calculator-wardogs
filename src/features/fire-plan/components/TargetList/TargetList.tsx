import { useLayoutEffect, useRef } from 'react'

import { display, metres } from '@/shared/format'
import { formatAzimuth, range } from '@/shared/geometry'
import { t } from '@/shared/i18n'

import { pointText, type Preset, type Target } from '../../core/presets'
import { isValidFire } from '../../core/solution'
import { rangeText, useFireFor } from '../../hooks/useFire'
import { useFirePlanActions, usePreset, useSaveStatus, useSelectedTarget } from '../../stores/firePlan'

function TargetRow({
  preset, target, index, isSelected,
}: {
  preset: Preset
  target: Target
  index: number
  isSelected: boolean
}) {
  const { choose, removeTarget } = useFirePlanActions()
  const f = useFireFor(preset, target)
  const valid = isValidFire(f) ? f : null
  // The big range on the right is the distance to the target until an impact corrects it: only then the distance is
  // repeated here.
  let detail: React.ReactNode = null
  if (!preset.player) detail = <span className="card-range">{t('list.noPosition')}</span>
  else if (target.hit) {
    detail = (
      <span className="card-range">
        {t('list.toTarget', {
          d: metres(range(preset.player, target.point)),
        })}
      </span>
    )
  }
  let shot: React.ReactNode = null
  if (target.hit && valid) {
    shot = (
      <>
        <span className="target-coefficient" title={t('list.coefTitle')}>{'K ×' + display(valid.coefficient ?? 0)}</span>
        <span className="card-shots">
          {t('list.shot', {
            n: valid.shots,
          })}
        </span>
      </>
    )
  } else if (target.hit) shot = <span className="card-error">{t('list.checkHit')}</span>
  const className = ['target-row', isSelected ? 'selected' : '', target.hit ? 'corrected' : ''].filter(Boolean).join(' ')
  return (
    <div className={className} data-target-id={target.id}>
      <button
        type="button"
        className="target-select"
        aria-pressed={isSelected}
        title={t('list.selectTitle', {
          key: index < 9 ? index + 1 : t('list.click'),
        })}
        onClick={() => choose(target.id)}
      >
        <strong className="card-number">{target.id}</strong>
        <span className="target-azimuth" title={t('list.azimuthTitle')}>{valid ? formatAzimuth(valid.azimuth) : '—'}</span>
        <span className="target-power" title={t(target.hit ? 'list.rangeCorrected' : 'list.rangeTarget')}>
          {valid ? rangeText(valid) : '—'}
        </span>
        <span className="target-detail">
          <span className="card-coords">{pointText(target.point)}</span>
          {detail}
          {shot}
        </span>
      </button>
      <button
        type="button"
        className="target-remove"
        title={t('list.removeTitle')}
        aria-label={t('list.removeLabel', {
          id: target.id,
        })}
        onClick={() => removeTarget(target.id)}
      >
        ×
      </button>
    </div>
  )
}

const SAVE_TEXT = {
  autosave: 'targets.autosave',
  saved: 'targets.saved',
  notSaved: 'targets.notSaved',
  readError: 'targets.readError',
} as const

/** The targets of the preset, each with its own solution; up to 10 show whole, more scroll. */
export function TargetList() {
  const preset = usePreset()
  const selected = useSelectedTarget()
  const saveStatus = useSaveStatus()
  const listRef = useRef<HTMLDivElement>(null)

  // The compact window grows with its content up to ten rows; the selected row is kept in view.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const rows = list.children
    const tenth = rows.length > 10
      ? rows[9].getBoundingClientRect().bottom - rows[0].getBoundingClientRect().top
      : 0
    list.style.setProperty('--list-max', tenth > 0 ? Math.ceil(tenth) + 'px' : 'none')
    const active = list.querySelector('.selected')
    if (!active || list.scrollHeight <= list.clientHeight) return
    const row = active.getBoundingClientRect()
    const box = list.getBoundingClientRect()
    if (row.bottom > box.bottom) list.scrollTop += row.bottom - box.bottom
    else if (row.top < box.top) list.scrollTop -= box.top - row.top
  })

  const isError = saveStatus === 'notSaved' || saveStatus === 'readError'
  const saveTitle = saveStatus === 'notSaved'
    ? t('targets.notSavedTitle')
    : saveStatus === 'readError' ? t('targets.readErrorTitle') : t('targets.autosaveTitle')
  return (
    <>
      <h2 className="target-heading">
        <span>{t('targets.title')}</span> <span id="target-count">{preset.targets.length}</span>
        <small id="preset-status" className={isError ? 'error' : undefined} title={saveTitle}>{t(SAVE_TEXT[saveStatus])}</small>
      </h2>
      <div id="target-list" ref={listRef} data-empty={t('targets.empty')}>
        {preset.targets.map((target, index) => (
          <TargetRow
            key={target.id}
            preset={preset}
            target={target}
            index={index}
            isSelected={target === selected}
          />
        ))}
      </div>
    </>
  )
}
