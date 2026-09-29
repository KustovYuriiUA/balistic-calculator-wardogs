import { describe, expect, it } from 'vitest'

import { en } from '@/shared/i18n/en'
import { ru } from '@/shared/i18n/ru'
import { uk } from '@/shared/i18n/uk'

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
const tags = (text: string) => [...text.matchAll(/<\/?([a-z]+)[^>]*>/g)].map((m) => m[0].startsWith('</') ? '/' + m[1] : m[1])

describe.each([
  ['ru', ru],
  ['uk', uk],
])('the %s dictionary', (_, dictionary) => {
  it('has every English key and nothing else', () => {
    expect(Object.keys(dictionary).sort()).toEqual(Object.keys(en).sort())
  })

  it('keeps each text\'s placeholders and markup, and leaves none empty', () => {
    for (const [key, source] of Object.entries(en)) {
      const text = dictionary[key as keyof typeof en]
      expect(text.trim(), key).not.toBe('')
      expect(placeholders(text), key).toEqual(placeholders(source))
      expect(tags(text), key).toEqual(tags(source))
    }
  })
})
