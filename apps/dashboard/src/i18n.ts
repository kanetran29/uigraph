// SCAFFOLD ONLY — a minimal, honest i18n wiring. The dashboard is a single-user local dev
// tool whose on-screen text is mostly untranslatable IR vocabulary (must/may/unknown,
// screen/control/modal, route strings, component paths). Full i18n would be a large
// mechanical sweep with ICU plurals for almost no payoff, so it is DEFERRED. This scaffold
// translates only the handful of chrome strings actually wired (topbar + panel headings),
// proving the pattern + giving the Settings language control something real to drive. The
// app remains ~90% English by design; the trigger to revisit is a real second-locale user.

import { createContext, createElement, useContext, useState, type ReactNode } from 'react'
import { readStored, writeStored } from './storage'

export type Lang = 'en' | 'fi' | 'vi' | 'zh' | 'de'
type Dict = Record<string, string>
const KEY = 'uigraph.lang'

/** All supported language codes + their endonym (shown in the language picker). */
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'fi', label: 'Suomi' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'zh', label: '中文' },
  { code: 'de', label: 'Deutsch' },
]

const en: Dict = {
  'status.live': 'live',
  'status.offline': 'sample (offline)',
  'search.placeholder': 'Search nodes…',
  'panel.coverage': 'Coverage',
  'panel.changes': 'Changes since last map',
  'panel.proposals': 'Proposals',
  'panel.plan': 'Plan a feature',
  'panel.steps': 'Plan path',
  'panel.inspector': 'Inspector',
  'settings.title': 'Settings',
  'settings.theme': 'Theme',
  'settings.language': 'Language',
  'theme.system': 'System',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
}
const fi: Dict = {
  'status.live': 'käynnissä',
  'status.offline': 'näyte (offline)',
  'search.placeholder': 'Hae näkymiä…',
  'panel.coverage': 'Kattavuus',
  'panel.changes': 'Muutokset edellisestä kartoituksesta',
  'panel.proposals': 'Ehdotukset',
  'panel.plan': 'Suunnittele ominaisuus',
  'panel.steps': 'Suunnittele polku',
  'panel.inspector': 'Tarkastelu',
  'settings.title': 'Asetukset',
  'settings.theme': 'Teema',
  'settings.language': 'Kieli',
  'theme.system': 'Järjestelmä',
  'theme.light': 'Vaalea',
  'theme.dark': 'Tumma',
}
const vi: Dict = {
  'status.live': 'trực tiếp',
  'status.offline': 'mẫu (ngoại tuyến)',
  'search.placeholder': 'Tìm nút…',
  'panel.coverage': 'Độ bao phủ',
  'panel.changes': 'Thay đổi từ lần ánh xạ trước',
  'panel.proposals': 'Đề xuất',
  'panel.plan': 'Lập kế hoạch tính năng',
  'panel.steps': 'Lập kế hoạch đường đi',
  'panel.inspector': 'Trình kiểm tra',
  'settings.title': 'Cài đặt',
  'settings.theme': 'Giao diện',
  'settings.language': 'Ngôn ngữ',
  'theme.system': 'Hệ thống',
  'theme.light': 'Sáng',
  'theme.dark': 'Tối',
}
const zh: Dict = {
  'status.live': '实时',
  'status.offline': '示例（离线）',
  'search.placeholder': '搜索节点…',
  'panel.coverage': '覆盖率',
  'panel.changes': '自上次映射以来的变更',
  'panel.proposals': '提议',
  'panel.plan': '规划功能',
  'panel.steps': '规划路径',
  'panel.inspector': '检查器',
  'settings.title': '设置',
  'settings.theme': '主题',
  'settings.language': '语言',
  'theme.system': '系统',
  'theme.light': '浅色',
  'theme.dark': '深色',
}
const de: Dict = {
  'status.live': 'live',
  'status.offline': 'Beispiel (offline)',
  'search.placeholder': 'Knoten suchen…',
  'panel.coverage': 'Abdeckung',
  'panel.changes': 'Änderungen seit letzter Zuordnung',
  'panel.proposals': 'Vorschläge',
  'panel.plan': 'Funktion planen',
  'panel.steps': 'Pfad planen',
  'panel.inspector': 'Inspektor',
  'settings.title': 'Einstellungen',
  'settings.theme': 'Design',
  'settings.language': 'Sprache',
  'theme.system': 'System',
  'theme.light': 'Hell',
  'theme.dark': 'Dunkel',
}
const DICTS: Record<Lang, Dict> = { en, fi, vi, zh, de }

/** Translate a key for a language; fall back to en, then the raw key — never throws/blank. */
export function translate(lang: Lang, key: string): string {
  return DICTS[lang][key] ?? en[key] ?? key
}

/** The two seed dictionaries, exported so a parity test can assert their keys never drift. */
export const dicts = DICTS

/** Read the stored language; a known code is honored, everything else (incl. null/throw) is 'en'. */
export function readLang(): Lang {
  const v = readStored(KEY)
  return LANGS.some((l) => l.code === v) ? (v as Lang) : 'en'
}

interface LangContextValue {
  lang: Lang
  t: (key: string) => string
  setLang: (lang: Lang) => void
}
const LangCtx = createContext<LangContextValue>({ lang: 'en', t: (k) => translate('en', k), setLang: () => {} })

/** Provides the active language + a bound t(); setLang persists + re-renders consumers. */
export function LangProvider(props: { children: ReactNode }): JSX.Element {
  const [lang, setLangState] = useState<Lang>(readLang)
  const setLang = (l: Lang): void => {
    setLangState(l)
    writeStored(KEY, l)
    try {
      document.documentElement.lang = l
    } catch {
      // ignore
    }
  }
  const value: LangContextValue = { lang, t: (k) => translate(lang, k), setLang }
  return createElement(LangCtx.Provider, { value }, props.children)
}

/** Access the active language + bound t() + setLang. */
export function useT(): LangContextValue {
  return useContext(LangCtx)
}
