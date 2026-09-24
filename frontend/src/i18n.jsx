import { DICT } from './locales';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'bn', label: 'বাংলা' },
  { code: 'mr', label: 'मराठी' },
  { code: 'te', label: 'తెలుగు' },
  { code: 'ta', label: 'தமிழ்' },
  { code: 'gu', label: 'ગુજરાતી' },
  { code: 'kn', label: 'ಕನ್ನಡ' },
  { code: 'ml', label: 'മലയാളം' },
  { code: 'or', label: 'ଓଡ଼ିଆ' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ' },
  { code: 'as', label: 'অসমীয়া' },
];

const LangContext = createContext({ lang: 'en', setLang: () => {}, t: (k) => DICT.en[k] || k });

const initialLang = () => {
  try {
    const saved = localStorage.getItem('landsetu_lang');
    if (LANGUAGES.some((l) => l.code === saved)) return saved;
  } catch (e) { /* storage blocked */ }
  return 'en';
};

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(initialLang);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const value = useMemo(() => ({
    lang,
    setLang: (code) => {
      setLangState(code);
      try { localStorage.setItem('landsetu_lang', code); } catch (e) { /* storage blocked */ }
    },
    t: (key) => DICT[lang]?.[key] ?? DICT.en[key] ?? key,
  }), [lang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export const useT = () => useContext(LangContext);
