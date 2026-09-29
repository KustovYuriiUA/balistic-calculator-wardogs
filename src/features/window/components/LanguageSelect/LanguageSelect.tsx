import {
  LANGUAGE_CODES, LANGUAGES, LANGUAGE_IDS, getLanguage, isLanguage, t,
} from '@/shared/i18n'

interface LanguageSelectProps {
  id: string
}

/** The desktop app keeps the language and reloads the window in it; the web page keeps it in localStorage. */
export function LanguageSelect({ id }: LanguageSelectProps) {
  const change = (value: string) => {
    if (!isLanguage(value)) return
    if (window.overlay) {
      window.overlay.setLanguage(value)
      return
    }
    try {
      localStorage.setItem('shot-language', value)
    } catch {
      // Storage off: the page reloads in the same language.
    }
    location.reload()
  }
  return (
    <select
      id={id}
      className="lang-select"
      title={t('bar.language')}
      aria-label={t('bar.language')}
      value={getLanguage()}
      onChange={(e) => change(e.target.value)}
    >
      {LANGUAGE_IDS.map((l) => (
        <option key={l} value={l} title={LANGUAGES[l]}>
          {LANGUAGE_CODES[l]}
        </option>
      ))}
    </select>
  )
}
