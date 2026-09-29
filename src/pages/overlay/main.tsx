import './style.css'
import './maps.css'

import { createRoot } from 'react-dom/client'

import { getFirePlan } from '@/features/fire-plan'
import { getLanguage, setLanguage, t } from '@/shared/i18n'

import { App } from './App'
import { connectOverlay } from './bridge'

function storedLanguage() {
  try {
    return localStorage.getItem('shot-language')
  } catch {
    return null
  }
}

// The desktop app decides the language (the preload passes it on); the web page keeps the choice in localStorage.
setLanguage(window.overlay?.language ?? storedLanguage())
document.documentElement.lang = getLanguage()
document.title = t('app.title')
document.querySelector('meta[name=description]')?.setAttribute('content', t('app.description'))

getFirePlan().actions.start()
connectOverlay()
createRoot(document.getElementById('root')!).render(<App />)
