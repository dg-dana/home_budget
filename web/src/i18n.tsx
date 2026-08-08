import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { ApiError } from './api';
import { applyLanguage, LANGUAGE_KEY, readLanguage, type Language } from './language';
import { STRINGS, type StringKey } from './strings';

type Vars = Record<string, string | number>;
type NodeVars = Record<string, ReactNode>;

/**
 * Every `<key>_one` in the dictionary, with the suffix taken off. Distributing
 * over the union needs a naked type parameter, which is what the helper is for.
 */
type BaseOf<K> = K extends `${infer B}_one` ? B : never;
export type PluralKey = BaseOf<StringKey>;

export interface I18n {
  language: Language;
  setLanguage: (next: Language) => void;
  /** One string, with any `{named}` placeholders filled in. */
  t: (key: StringKey, vars?: Vars) => string;
  /**
   * The same, except a placeholder may be a React node — a `<strong>`, a
   * `<Link>`, a `<button>`. Keeping the whole sentence in one dictionary entry
   * is what lets German put its verb where German puts its verb; splitting it
   * into "before" and "after" halves at the call site does not translate.
   */
  tx: (key: StringKey, vars: NodeVars) => ReactNode;
  /** Picks `<key>_one` or `<key>_other`, and passes `count` through as a var. */
  plural: (count: number, key: PluralKey, vars?: Vars) => string;
  /**
   * Turns whatever a failed request threw into a sentence to put on screen.
   *
   * Three cases, in order. A refusal carrying a **code this build knows** is
   * translated, values and all. A refusal carrying an unknown code — or none —
   * falls back to the **server's English sentence**, which is exactly what the
   * app showed before codes existed and is never nothing. Anything that is not
   * an `Error` at all gets the caller's own fallback.
   *
   * The fallback to English is what makes partial coverage safe: a route that
   * grows a new refusal tomorrow is readable today.
   */
  message: (err: unknown, fallback: StringKey) => string;
}

const PLACEHOLDER = /\{(\w+)\}/g;

const I18nContext = createContext<I18n | null>(null);

function fill(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(PLACEHOLDER, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

function fillNodes(template: string, vars: NodeVars): ReactNode {
  const parts: ReactNode[] = [];
  let cut = 0;
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1];
    if (!(name in vars)) continue;
    parts.push(template.slice(cut, match.index));
    parts.push(<Fragment key={parts.length}>{vars[name]}</Fragment>);
    cut = match.index + match[0].length;
  }
  parts.push(template.slice(cut));
  return <>{parts}</>;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(readLanguage);

  useEffect(() => {
    applyLanguage(language);
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    // Applied *before* the state update, so the render it triggers already
    // formats money and dates in the new locale rather than one paint behind.
    applyLanguage(next);
    try {
      localStorage.setItem(LANGUAGE_KEY, next);
    } catch {
      // Not persisting is survivable; the choice still applies to this page.
    }
    setLanguageState(next);
  }, []);

  const value = useMemo<I18n>(() => {
    const column = language === 'de' ? 1 : 0;
    const line = (key: StringKey) => STRINGS[key][column];

    return {
      language,
      setLanguage,
      t: (key, vars) => fill(line(key), vars),
      tx: (key, vars) => fillNodes(line(key), vars),
      plural: (count, key, vars) =>
        fill(line(`${key}_${count === 1 ? 'one' : 'other'}` as StringKey), { count, ...vars }),
      message: (err, fallback) => {
        if (err instanceof ApiError && err.code && err.code in STRINGS) {
          return fill(line(err.code as StringKey), err.vars);
        }
        if (err instanceof Error) return err.message;
        return fill(line(fallback));
      },
    };
  }, [language, setLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside an I18nProvider');
  return context;
}
