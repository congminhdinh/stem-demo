import { describe, expect, it } from 'vitest';
import { blockWarningsOf } from './block-warnings';

// N18 R2.4: the diagnostics that name a block become the warnings BlocklyPanel puts on it.

type Diagnostic = { severity: 'error' | 'warning'; code: string; message: string; blockId?: string };
const diagnostic = (code: string, blockId?: string, severity: Diagnostic['severity'] = 'error'): Diagnostic => ({
  severity,
  code,
  message: `${code} happened`,
  ...(blockId === undefined ? {} : { blockId }),
});
const worded = (item: Diagnostic) => `${item.severity === 'error' ? 'Lỗi' : 'Cảnh báo'}: ${item.message}`;

describe('blockWarningsOf', () => {
  it('words each diagnostic that names a block with the caller’s text and leaves the others out', () => {
    expect(
      blockWarningsOf(
        [diagnostic('pin-conflict', 'a'), diagnostic('no-board'), diagnostic('value-clamped', 'b', 'warning')],
        worded,
      ),
    ).toEqual({ a: 'Lỗi: pin-conflict happened', b: 'Cảnh báo: value-clamped happened' });
  });

  it('joins the texts of one block by line breaks, in order, each once', () => {
    expect(
      blockWarningsOf([diagnostic('timer-claimed', 'a'), diagnostic('pin-unavailable', 'a'), diagnostic('timer-claimed', 'a')], worded),
    ).toEqual({ a: 'Lỗi: timer-claimed happened\nLỗi: pin-unavailable happened' });
  });

  it('gives an empty record for no diagnostics, and keeps a block id such as __proto__ as an ordinary key', () => {
    expect(blockWarningsOf([], worded)).toEqual({});
    const record = blockWarningsOf([diagnostic('pin-conflict', '__proto__')], worded);
    expect(Object.keys(record)).toEqual(['__proto__']);
    expect(Object.hasOwn(record, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
  });
});
