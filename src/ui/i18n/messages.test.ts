import { describe, expect, it } from 'vitest';
import { en, isMessageKey, translate, vi, type MessageKey } from './messages';

const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
const keys = Object.keys(en) as MessageKey[];

describe('UI messages (N6a S5)', () => {
  it('has every key in both languages, and no other', () => {
    expect(Object.keys(vi).sort()).toEqual([...keys].sort());
  });

  it.each(keys)('%s has the same parameters in both languages, and no empty text', (key) => {
    expect(params(vi[key])).toEqual(params(en[key]));
    expect(vi[key].trim()).not.toBe('');
  });

  it('fills the parameters, and leaves an unknown one as written', () => {
    expect(translate('vi', 'palette.add', { name: 'Đèn LED' })).toBe('Thêm Đèn LED');
    expect(translate('en', 'console.hiddenMany', { count: 3 })).toBe('3 earlier lines hidden');
    expect(translate('en', 'palette.add')).toBe('Add {name}');
  });

  it('keeps the English of the standalone editor as it was', () => {
    expect(translate('en', 'run.status.finished')).toBe('Program finished — board powered');
    expect(translate('en', 'python.claim')).toBe(
      'Generated for Yolo:Bit MicroPython. MicroPython syntax validation: pending. Physical-board verification: pending.',
    );
  });

  it.each(['device.led', 'control.light'])('knows %s', (key) => {
    expect(isMessageKey(key)).toBe(true);
  });

  // N17 B5 made device.servo a key; a motor is still no device of the app.
  it.each(['device.motor', 'toString', 'constructor', ''])('does not take %j for a key', (key) => {
    expect(isMessageKey(key)).toBe(false);
  });
});
