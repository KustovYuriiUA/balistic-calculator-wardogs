import { en } from './en'
import { ru } from './ru'
import { uk } from './uk'

export type Language = 'en' | 'ru' | 'uk'

export type TextKey = keyof typeof en

export type TextVars = Record<string, string | number>

/** Each language by its own name, for the language lists. */
export const LANGUAGES: Record<Language, string> = {
  en: 'English',
  ru: 'Русский',
  uk: 'Українська',
}

/** Short codes for the window bar's select. Ukrainian shows UA: "UK" reads as the United Kingdom. */
export const LANGUAGE_CODES: Record<Language, string> = {
  en: 'EN',
  ru: 'RU',
  uk: 'UA',
}

export const LANGUAGE_IDS = Object.keys(LANGUAGES) as Language[]

const dictionaries: Record<Language, Record<TextKey, string>> = {
  en,
  ru,
  uk,
}

// One language per process: main decides and the pages take it from their preload before anything renders. A new
// language reloads the overlay window, so nothing needs to re-render on a change.
let current: Language = 'en'

export const isLanguage = (value: unknown): value is Language =>
  typeof value === 'string' && Object.hasOwn(LANGUAGES, value)

/** Anything but a known language falls back to English. */
export function setLanguage(next: unknown): Language {
  current = isLanguage(next) ? next : 'en'
  return current
}

export const getLanguage = () => current

export function t(key: TextKey, vars?: TextVars): string {
  const text = dictionaries[current][key] ?? en[key] ?? key
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => name in vars ? String(vars[name]) : match)
}

const LOCALES: Record<Language, string> = {
  en: 'en-US',
  ru: 'ru-RU',
  uk: 'uk-UA',
}

export const locale = () => LOCALES[current]

export const formatNumber = (n: number, maximumFractionDigits = 2) =>
  new Intl.NumberFormat(locale(), {
    maximumFractionDigits,
  }).format(n)

export const decimalSeparator = () => current === 'en' ? '.' : ','
