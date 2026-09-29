import { formatNumber, t } from '@/shared/i18n'

/** A number in the interface language: "2,720.29" or "2 720,29". */
export const display = (n: number) => formatNumber(n)

export const metres = (n: number) => formatNumber(n, 0) + ' ' + t('unit.m')

/** Signed degrees with a real minus: "+1.2°", "−0.4°". */
export const signedDegrees = (n: number) =>
  (n > 0 ? '+' : n < 0 ? '−' : '') + display(Math.abs(Math.round(n * 10) / 10)) + '°'
