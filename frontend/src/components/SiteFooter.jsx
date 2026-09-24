import React from 'react';
import { useT } from '../i18n';

/* eslint-disable no-undef */
const BUILD_DATE = typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : '';

export default function SiteFooter() {
  const { t } = useT();
  return (
    <footer className="site-footer">
      <div className="site-footer-grid">
        <div>
          <h2>{t('footer.about')}</h2>
          <p>{t('footer.aboutText')}</p>
          <h2>{t('footer.notice')}</h2>
          <p>{t('footer.noticeText')}</p>
        </div>
        <div>
          <h2>{t('footer.sitemap')}</h2>
          <ul>
            <li><a href="#/">{t('nav.home')}</a></li>
            <li><a href="#/search">{t('nav.search')}</a></li>
            <li><a href="#/map">{t('nav.map')}</a></li>
            <li><a href="#/how-it-works">{t('nav.how')}</a></li>
            <li><a href="#/coverage">{t('nav.coverage')}</a></li>
            <li><a href="#/services">{t('nav.services')}</a></li>
            <li><a href="#/bank">Lender verification</a></li>
            <li><a href="#/developers">Developer API</a></li>
            <li><a href="#/faq">{t('nav.help')}</a></li>
            <li><a href="#/about">{t('footer.about')}</a></li>
          </ul>
        </div>
        <div>
          <h2>{t('footer.contact')}</h2>
          <p>{t('footer.contactText')}</p>
          <p><a href="#/grievance">{t('nav.grievance')}</a></p>
          <h2>{t('footer.legal')}</h2>
          <ul>
            <li><a href="#/terms">{t('footer.terms')}</a></li>
            <li><a href="#/privacy">{t('footer.privacy')}</a></li>
            <li><a href="#/accessibility">{t('footer.accessibility')}</a></li>
          </ul>
        </div>
      </div>
      <div className="site-footer-base">
        <span>{t('footer.rights')}</span>
        {BUILD_DATE && <span className="tabular">{t('footer.updated')}: {BUILD_DATE}</span>}
      </div>
    </footer>
  );
}
