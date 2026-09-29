import { t, type TextKey } from '@/shared/i18n'

const HINTS: TextKey[] = ['sb.place', 'sb.hit', 'sb.zoom', 'sb.pan', 'sb.pick', 'sb.remove', 'sb.undo']

/** The mouse and key hints under the map (the markup comes from the dictionary). */
export function StatusBar() {
  return (
    <footer className="statusbar">
      {HINTS.map((key) => (
        <span key={key} dangerouslySetInnerHTML={{
          __html: t(key),
        }} />
      ))}
      <span className="credit">{t('sb.credit')}</span>
    </footer>
  )
}
