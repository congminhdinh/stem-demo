import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { translate, type Locale, type MessageKey, type Params } from './messages';

// The UI's language, chosen once at startup (main.tsx) and read by every component through `useText`.
// Without a provider it is English, so a component rendered alone (its unit tests) reads as it always did.

const LocaleContext = createContext<Locale>('en');

export function TextProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}

export const useLocale = (): Locale => useContext(LocaleContext);

export type Text = (key: MessageKey, params?: Params) => string;

/** `t(key, params)` in the UI's language. */
export function useText(): Text {
  const locale = useLocale();
  return useMemo(() => (key, params) => translate(locale, key, params), [locale]);
}
