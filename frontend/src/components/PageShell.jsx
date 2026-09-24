import React, { useEffect } from 'react';
import { useT } from '../i18n';

// Common frame for text pages: breadcrumb, title, optional draft banner, English-only note.
export default function PageShell({ title, draft = false, children }) {
  const { t, lang } = useT();
  useEffect(() => { document.title = `${title} | LandSetu`; }, [title]);
  return (
    <article className="page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <a href="#/">{t('crumb.home')}</a><span aria-hidden="true"> / </span><span aria-current="page">{title}</span>
      </nav>
      <h1>{title}</h1>
      {draft && <div className="callout callout--alert">Draft. This text has not been reviewed by a lawyer and must be before any public use.</div>}
      {lang !== 'en' && <div className="callout">{t('page.englishOnly')}</div>}
      {children}
    </article>
  );
}
