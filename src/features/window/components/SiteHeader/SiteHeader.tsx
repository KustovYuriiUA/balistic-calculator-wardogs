import { t } from '@/shared/i18n'

import { LanguageSelect } from '../LanguageSelect'
import { Logo } from '../Logo'

/** The web page's header; the desktop window has the title bar instead. */
export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="brand">
        <Logo />
        <span>{t('app.name')}</span>
        <span className="brand-tag">{t('header.tag')}</span>
      </div>
      <span className="header-end">
        <span className="scale">{t('header.scale')}</span>
        <LanguageSelect id="language-select-web" />
      </span>
    </header>
  )
}
