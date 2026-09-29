import { display, metres, signedDegrees } from '@/shared/format'
import { formatAzimuth } from '@/shared/geometry'
import { t } from '@/shared/i18n'

import { isValidFire } from '../../core/solution'
import { rangeText, useSelectedFire } from '../../hooks/useFire'
import { useFirePlanActions, usePreset, useSelectedTarget } from '../../stores/firePlan'

interface FireSolutionProps {
  onManual: () => void
}

/** What to dial in the game for the selected target: corrected azimuth and range once an impact is marked. */
export function FireSolution({ onManual }: FireSolutionProps) {
  const preset = usePreset()
  const target = useSelectedTarget()
  const f = useSelectedFire()
  const { resetCorrection } = useFirePlanActions()
  const valid = isValidFire(f) ? f : null
  let meta: React.ReactNode = null
  if (!preset.player) meta = t('fs.noPosition')
  else if (!target) meta = t(preset.targets.length ? 'fs.pickTarget' : 'fs.markTarget')
  else if (!valid) meta = t('fs.check')
  // Before a correction the range above is the distance to the target: repeating it here only adds noise.
  else if (valid.isCorrected) {
    meta = (
      <>
        <span>{t('fs.toTarget')} <b>{metres(valid.targetDistance)}</b></span>
        <span>{t('fs.hit')} <b>{metres(valid.hitDistance ?? 0)}</b></span>
        <span className="aim">K <b>{'×' + display(valid.coefficient ?? 0)}</b></span>
        <span className="aim">{t('fs.dAz')} <b>{signedDegrees(valid.delta)}</b></span>
      </>
    )
  }
  return (
    <section
      id="fire-solution"
      className={'fire-solution hud-frame' + (valid ? '' : ' empty')}
      aria-labelledby="fs-title"
      aria-live="polite"
    >
      <div className="panel-head">
        <h2 id="fs-title">{t('fs.title')}</h2>
        <span id="fs-target" className="fs-target">
          {target
            ? t('fs.target', {
              id: target.id,
            })
            : t('fs.targetNone')}
        </span>
        <span id="fs-tag" className="tag" hidden={!valid?.isCorrected}>
          {valid && valid.shots > 1
            ? t('fs.correctionN', {
              n: valid.shots,
            })
            : t('fs.correction')}
        </span>
      </div>
      <div className="fs-values">
        <div className="fs-cell">
          <span className="fs-label">{t('fs.azimuth')}</span>
          <output id="fs-azimuth">{valid ? formatAzimuth(valid.azimuth) : '—'}</output>
        </div>
        <div className="fs-cell">
          <span className="fs-label">{t('fs.range')}</span>
          <output id="fs-range">{valid ? rangeText(valid) : '—'}</output>
        </div>
      </div>
      <p id="fs-meta" className="fs-meta">{meta}</p>
      <div id="map-solution" className="fs-actions">
        <button
          id="reset-correction"
          type="button"
          className="ghost"
          hidden={!target?.hit}
          title={t('fs.resetTitle')}
          onClick={resetCorrection}
        >
          {t('fs.reset')}
        </button>
        <button id="open-correction" type="button" className="ghost" onClick={onManual}>{t('fs.manual')}</button>
      </div>
    </section>
  )
}
