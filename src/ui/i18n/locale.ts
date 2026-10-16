import type { Launch } from '../app/launch';
import type { Locale } from './messages';

/**
 * The language of the UI for this launch (N6a S5): `lang=vi` or `lang=en` when given; otherwise Vietnamese for
 * a lab launch (`lab=`, the LMS's labs, including a broken one) and English for the standalone editor and the
 * legacy S1 lab, which stay as they were.
 */
export function localeOf(launch: Launch, search: string): Locale {
  const lang = new URLSearchParams(search).get('lang');
  if (lang === 'vi' || lang === 'en') {
    return lang;
  }
  return launch.mode !== 'standalone' && launch.lab !== undefined ? 'vi' : 'en';
}
