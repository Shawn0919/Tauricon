// Translations live in src/locales/<code>.json, one file per language.
// To add a language, drop in a new file (e.g. ja.json) with the same keys as
// zh-TW.json; it is picked up automatically and appears in Settings.
// Missing keys fall back to zh-TW, the base locale.
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import base from "../locales/zh-TW.json";

export type MessageKey = keyof typeof base;
type Messages = Partial<Record<MessageKey, string>>;
export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const BASE_LOCALE = "zh-TW";
const FALLBACK_LOCALE = "en";

const LOCALE_FILES = import.meta.glob<Messages>("../locales/*.json", {
  eager: true,
  import: "default",
});

const CATALOG: Record<string, Messages> = Object.fromEntries(
  Object.entries(LOCALE_FILES).map(([path, messages]) => [
    path.replace(/^.*\/([^/]+)\.json$/, "$1"),
    messages,
  ]),
);

export interface LocaleOption {
  code: string;
  name: string;
}

/** Every bundled language, named in its own language. */
export const LOCALES: LocaleOption[] = Object.entries(CATALOG)
  .map(([code, messages]) => ({ code, name: messages["meta.name"] ?? code }))
  .sort((a, b) => a.code.localeCompare(b.code));

export function isMessageKey(key: string): key is MessageKey {
  return key in base;
}

/**
 * System locales that should map to a specific bundled file, where matching by
 * language alone would be ambiguous (Chinese has two scripts). Keys are
 * lowercase; a key also matches longer tags, e.g. "zh-hant" matches "zh-Hant-HK".
 */
const LOCALE_ALIASES: Record<string, string> = {
  "zh-hant": "zh-TW",
  "zh-hk": "zh-TW",
  "zh-mo": "zh-TW",
  "zh-hans": "zh-CN",
  "zh-sg": "zh-CN",
  zh: "zh-CN",
};

function aliasFor(tag: string): string | undefined {
  const parts = tag.toLowerCase().split("-");
  // Most specific first: "zh-hant-hk" → "zh-hant-hk", "zh-hant", "zh".
  for (let n = parts.length; n > 0; n--) {
    const alias = LOCALE_ALIASES[parts.slice(0, n).join("-")];
    if (alias && CATALOG[alias]) return alias;
  }
  return undefined;
}

/** "system" or a locale code → a bundled locale code. */
export function resolveLocale(preference: string): string {
  if (preference !== "system" && CATALOG[preference]) return preference;

  const codes = Object.keys(CATALOG);
  for (const wanted of navigator.languages) {
    const exact = codes.find((c) => c.toLowerCase() === wanted.toLowerCase());
    if (exact) return exact;
    const alias = aliasFor(wanted);
    if (alias) return alias;
    const language = wanted.split("-")[0].toLowerCase();
    const sameLanguage = codes.find((c) => c.split("-")[0].toLowerCase() === language);
    if (sameLanguage) return sameLanguage;
  }
  return CATALOG[FALLBACK_LOCALE] ? FALLBACK_LOCALE : BASE_LOCALE;
}

interface I18n {
  locale: string;
  t: Translate;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ locale, children }: { locale: string; children: ReactNode }) {
  const t = useCallback<Translate>(
    (key, vars) => {
      const template = CATALOG[locale]?.[key] ?? base[key] ?? key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in vars ? String(vars[name]) : match,
      );
    },
    [locale],
  );
  const value = useMemo(() => ({ locale, t }), [locale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
