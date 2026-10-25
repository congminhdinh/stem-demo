import type { Locale } from '../i18n/messages';

// Numbers in the robot lab's UI (N18 R4.4), in the learner's language: Vietnamese writes a decimal comma (0,5×, 3,2 s), English a point.
// No grouping: the lab's numbers are seconds and speeds, never thousands.

const formats = new Map<string, Intl.NumberFormat>();

/** `value` in `locale`, with exactly `fractionDigits` decimals, or as few as it needs (at most 3) when it is not given. */
export function formatNumber(value: number, locale: Locale, fractionDigits?: number): string {
  const key = `${locale}:${fractionDigits ?? '-'}`;
  let format = formats.get(key);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
      useGrouping: false,
      minimumFractionDigits: fractionDigits ?? 0,
      maximumFractionDigits: fractionDigits ?? 3,
    });
    formats.set(key, format);
  }
  return format.format(value);
}
