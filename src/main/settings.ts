import fs from 'node:fs'
import path from 'node:path'

import { isLanguage, type Language } from '@/shared/i18n'

// userData/settings.json: the interface language, owned by main. Pages get it from their preload.

export function readLanguage(file: string): Language {
  try {
    const { language } = JSON.parse(fs.readFileSync(file, 'utf8'))
    return isLanguage(language) ? language : 'en'
  } catch {
    return 'en'
  }
}

export function saveLanguage(file: string, language: Language) {
  try {
    fs.mkdirSync(path.dirname(file), {
      recursive: true,
    })
    fs.writeFileSync(file, JSON.stringify({
      language,
    }))
  } catch (error) {
    console.warn('Could not save settings.json:', (error as Error).message)
  }
}
