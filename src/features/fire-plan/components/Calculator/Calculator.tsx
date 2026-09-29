import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react'

import { display } from '@/shared/format'
import { formatAzimuth, type GamePoint } from '@/shared/geometry'
import { t, type TextKey } from '@/shared/i18n'

import {
  aimCoordinates,
  type CalcDiagram,
  type CalcField,
  type CalcNote,
  type CalcResult,
} from '../../core/calculator'
import { useCalculator, useFirePlanActions, type CalcStatus } from '../../stores/firePlan'

const STATUS: Record<CalcStatus, TextKey> = {
  coords: 'calc.waitCoords',
  calc: 'calc.waitCalc',
  range: 'calc.rangeReady',
  estimate: 'calc.estimateReady',
}

const FIELD_IDS: Record<CalcField, string> = {
  player: 'player',
  target: 'target',
  hit: 'hit',
  distance: 'distance',
  previousAim: 'previous-aim',
}

const m = () => ' ' + t('unit.m')

function noteText(note: CalcNote) {
  if (note.kind === 'test') return t('calc.testNote')
  if (note.kind === 'base') return t('calc.baseNote')
  if (note.kind === 'coefficient') return t('calc.coefNote')
  return t('calc.prevNote', {
    d: display(note.distance),
    k: display(note.coefficient),
  })
}

const COLOURS = {
  player: '#fff2dd',
  target: '#ffd24a',
  hit: '#ff6a3d',
  aim: '#c9a7ff',
}

const OFFSETS = {
  player: [12, 22],
  target: [12, -16],
  hit: [12, 24],
  aim: [12, -32],
}

type DiagramKey = keyof typeof COLOURS

/** The shot seen from above: position, target, impact and the corrected aim, fitted into the panel. */
function Diagram({ diagram }: { diagram: CalcDiagram }) {
  const points = Object.entries(diagram).filter(([, p]) => p) as [DiagramKey, GamePoint][]
  const xs = points.map(([, p]) => p.x)
  const ys = points.map(([, p]) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const scale = Math.min(380 / Math.max(maxX - minX, 1e-9), 190 / Math.max(maxY - minY, 1e-9))
  const map = (p: GamePoint) => ({
    x: 260 + (p.x - (minX + maxX) / 2) * scale,
    y: 145 - (p.y - (minY + maxY) / 2) * scale,
  })
  const origin = map(diagram.player)
  const labels: Record<DiagramKey, string> = {
    player: t('legend.me'),
    target: t('legend.target'),
    hit: t('legend.hit'),
    aim: t('legend.aim'),
  }
  return (
    <>
      {(['target', 'hit', 'aim'] as const).filter((key) => diagram[key]).map((key) => {
        const p = map(diagram[key]!)
        return (
          <line
            key={'l' + key}
            x1={origin.x}
            y1={origin.y}
            x2={p.x}
            y2={p.y}
            stroke={COLOURS[key]}
            strokeWidth={1.5}
            opacity={.65}
            strokeDasharray={key === 'aim' ? '6 6' : undefined}
          />
        )
      })}
      {points.map(([key, point]) => {
        const p = map(point)
        const [dx, dy] = OFFSETS[key]
        return (
          <g key={key}>
            <circle
              cx={p.x}
              cy={p.y}
              r={key === 'target' ? 9 : 5}
              fill={key === 'target' ? '#08090a' : COLOURS[key]}
              stroke={COLOURS[key]}
              strokeWidth={2}
            />
            <text
              x={p.x + dx}
              y={p.y + dy}
              fill={COLOURS[key]}
              fontSize={13}
              fontWeight={600}
              fontFamily="Bahnschrift, Segoe UI, sans-serif"
            >
              {labels[key]}
            </text>
          </g>
        )
      })}
    </>
  )
}

function Result({ result }: { result: CalcResult }) {
  const calc = useCalculator()
  const { setCopy } = useFirePlanActions()
  const aimRef = useRef<HTMLOutputElement>(null)
  const distanceText = result.distance === null
    ? '× ' + display(result.coefficient ?? 0)
    : display(result.distance) + m()

  async function copy() {
    const text = aimCoordinates(result.aim)
    try {
      if (window.overlay) await window.overlay.copyCoordinates(text)
      else await navigator.clipboard.writeText(text)
      setCopy('copied')
    } catch {
      const selection = window.getSelection()
      if (aimRef.current && selection) {
        const r = document.createRange()
        r.selectNodeContents(aimRef.current)
        selection.removeAllRanges()
        selection.addRange(r)
      }
      setCopy('manual')
    }
  }

  const copyText = calc.copy === 'copied' ? t('calc.copied') : calc.copy === 'manual' ? t('calc.pressCtrlC') : t('calc.copy')
  return (
    <div id="result">
      <div className="readout">
        <div className="readout-cell azimuth">
          <p className="result-label">{t('fs.azimuth')}</p>
          <output id="aim-azimuth">{formatAzimuth(result.azimuth)}</output>
          <small>{t('calc.azimuthNote')}</small>
        </div>
        <div className="readout-cell range">
          <p className="result-label">{t('fs.range')}</p>
          <output id="distance-value">{distanceText}</output>
        </div>
      </div>
      <p id="distance-note" className="hint">{noteText(result.note)}</p>
      <div className="aim-line">
        <div>
          <p className="result-label">{t('calc.aimPoint')}</p>
          <output id="aim-value" ref={aimRef}>{`Y ${display(result.aim.y)}   X ${display(result.aim.x)}`}</output>
        </div>
        <button type="button" className="ghost copy" id="copy" aria-label={t('calc.copyLabel')} onClick={copy}>{copyText}</button>
      </div>
      <div className="stats">
        <div><span>{t('calc.toTarget')}</span><strong id="target-distance">{display(result.targetDistance) + m()}</strong></div>
        <div>
          <span>{t('calc.toHit')}</span>
          <strong id="hit-distance">{result.hitDistance === null ? '—' : display(result.hitDistance) + m()}</strong>
        </div>
        <div>
          <span>{t('calc.coefficient')}</span>
          <strong id="coefficient">{result.coefficient === null ? '—' : '× ' + display(result.coefficient)}</strong>
        </div>
      </div>
    </div>
  )
}

interface FieldProps {
  field: CalcField
  label: TextKey
  dot?: string
  placeholder: string
  describedBy: string
  onEnter?: () => void
}

function Field({
  field, label, dot, placeholder, describedBy, onEnter,
}: FieldProps) {
  const calc = useCalculator()
  const { inputField } = useFirePlanActions()
  const id = FIELD_IDS[field]
  const error = calc.errors[field]
  const onKeyDown = onEnter && ((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      onEnter()
    }
  })
  return (
    <div className="field">
      <label htmlFor={id}>{dot && <span className={'dot ' + dot} />}<span>{t(label)}</span></label>
      <input
        id={id}
        name={field}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        value={calc.fields[field]}
        onChange={(e) => inputField(field, e.target.value)}
        onKeyDown={onKeyDown}
      />
      <p className="field-error" id={id + '-error'}>{error ?? ''}</p>
    </div>
  )
}

interface CalculatorProps {
  isHidden: boolean
}

/** The manual calculator: the selected target's shot data as a form, the range to it, the corrected shot. */
export function Calculator({ isHidden }: CalculatorProps) {
  const calc = useCalculator()
  const {
    calculateBase, calculateCorrection, example, inputField, setAimDetailsOpen,
  } = useFirePlanActions()
  const { focus } = calc

  useEffect(() => {
    if (focus) document.getElementById(FIELD_IDS[focus.field])?.focus()
  }, [focus])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    calculateCorrection()
  }
  const distanceError = calc.errors.distance
  return (
    <div className="workspace" id="calculator-workspace" hidden={isHidden}>
      <section className="panel inputs" aria-labelledby="input-title">
        <div className="section-title">
          <h2 id="input-title">{t('calc.inputTitle')}</h2>
          <button className="ghost" id="example" type="button" onClick={example}>{t('calc.example')}</button>
        </div>
        <form id="shot-form" noValidate onSubmit={submit}>
          <p className="step-label"><b>1</b><span>{t('calc.step1')}</span></p>
          <Field field="player" label="calc.player" dot="player" placeholder="Y102 X88" describedBy="coord-help player-error" onEnter={calculateBase} />
          <Field field="target" label="calc.target" dot="target" placeholder="Y80 X72" describedBy="coord-help target-error" onEnter={calculateBase} />
          <button type="button" className="primary" id="calculate-distance" onClick={calculateBase}>
            <span>{t('calc.distanceButton')}</span> <kbd>Enter</kbd>
          </button>
          <p id="base-status" className="hint" role="status">
            {calc.baseMetres === null
              ? ''
              : t('calc.baseStatus', {
                d: display(calc.baseMetres),
              })}
          </p>
          <p id="coord-help" className="hint" dangerouslySetInnerHTML={{
            __html: t('calc.coordHelp'),
          }} />
          <div className="divider" />
          <p className="step-label"><b>2</b><span>{t('calc.step2')}</span></p>
          <div className="field">
            <label htmlFor="distance">{t('calc.distance')}</label>
            <div className="unit-input">
              <input
                id="distance"
                name="distance"
                inputMode="decimal"
                placeholder={t('calc.distancePlaceholder')}
                aria-describedby="distance-help distance-error"
                aria-invalid={distanceError ? true : undefined}
                value={calc.fields.distance}
                onChange={(e) => inputField('distance', e.target.value)}
              />
              <span>{t('unit.m')}</span>
            </div>
            <p id="distance-help" className="hint">{t('calc.distanceHelp')}</p>
            <p className="field-error" id="distance-error">{distanceError ?? ''}</p>
          </div>
          <Field field="hit" label="calc.hit" dot="hit" placeholder="Y93 X80" describedBy="coord-help hit-error" onEnter={calculateCorrection} />
          <details
            id="aim-details"
            open={calc.isAimDetailsOpen}
            onToggle={(e) => setAimDetailsOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary>{t('calc.aimDetails')}</summary>
            <Field field="previousAim" label="calc.prevAim" placeholder={t('calc.prevAimPlaceholder')} describedBy="previous-aim-error" />
          </details>
          <button type="submit" className="primary">
            <span>{t('calc.correctButton')}</span> <span aria-hidden="true">↗</span>
          </button>
          <p id="form-error" className="field-error" role="alert">{calc.errors.form ?? ''}</p>
        </form>
      </section>
      <section className="results" aria-label={t('calc.results')}>
        <div className="panel result-panel hud-frame" aria-live="polite">
          <div className="section-title">
            <h2>{t('calc.next')}</h2>
            <span id="status" className={'badge' + (calc.status === 'estimate' ? ' ready' : '')}>{t(STATUS[calc.status])}</span>
          </div>
          <div id="empty" hidden={Boolean(calc.result)}>
            <div className="empty-mark" aria-hidden="true">⌖</div>
            <h3>{t('calc.emptyTitle')}</h3>
            <p>{t('calc.emptyText')}</p>
          </div>
          {calc.result && <Result result={calc.result} />}
        </div>
        <div className="panel map-panel">
          <div className="section-title"><h2>{t('calc.topView')}</h2><span className="hint">X → · Y ↑</span></div>
          <div className="map">
            <svg id="map" viewBox="0 0 520 290" role="img" aria-label={t('calc.schemeLabel')}>
              {calc.result
                ? <Diagram diagram={calc.result.diagram} />
                : (
                  <text x={260} y={150} textAnchor="middle" fill="#6b7580" fontSize={15}>
                    {t(calc.status === 'coords' ? 'calc.schemeEmpty' : 'calc.schemeRecalc')}
                  </text>
                )}
            </svg>
          </div>
          <div className="legend">
            <span><i className="dot player" /><span>{t('legend.me')}</span></span>
            <span><i className="dot target" /><span>{t('legend.target')}</span></span>
            <span><i className="dot hit" /><span>{t('legend.hit')}</span></span>
            <span><i className="dot aim" /><span>{t('legend.aim')}</span></span>
          </div>
        </div>
        <p className="model-note" dangerouslySetInnerHTML={{
          __html: t('calc.note'),
        }} />
      </section>
    </div>
  )
}
