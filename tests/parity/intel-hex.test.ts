import { describe, expect, it } from 'vitest';
import { FLASH_BYTES, parseIntelHex } from './intel-hex';

// N18 C2: the parity harness loads only a whole, unaltered HEX.

/** One record with its checksum: `:` count, address, type, data, two's complement of the sum. */
function record(address: number, type: number, data: number[]): string {
  const bytes = [data.length, address >> 8, address & 0xff, type, ...data];
  const sum = bytes.reduce((total, byte) => total + byte, 0);
  return `:${[...bytes, (0x100 - (sum & 0xff)) & 0xff].map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join('')}`;
}
const end = ':00000001FF';

describe('parseIntelHex', () => {
  it('puts each data record at its address, little-endian words, the rest of the 32 KB flash 0', () => {
    const flash = parseIntelHex([record(0x0000, 0, [0x0c, 0x94, 0x5c, 0x00]), record(0x0010, 0, [0xff]), end, ''].join('\r\n'));
    expect(flash.length).toBe(FLASH_BYTES / 2);
    expect([flash[0], flash[1], flash[8], flash[9]]).toEqual([0x940c, 0x005c, 0x00ff, 0]);
  });

  it('reads the first record arduino-cli wrote for the empty program (tests/__parity__/empty-program.hex): jmp vectors', () => {
    expect(parseIntelHex(`:100000000C9434000C9446000C9446000C9446006A\r\n${end}\r\n`).slice(0, 4)).toEqual(Uint16Array.from([0x940c, 0x0034, 0x940c, 0x0046]));
  });

  it('refuses a bad checksum, a short record, data past the flash, an unknown type, a missing end and a record after it', () => {
    const good = record(0, 0, [1, 2]);
    const badSum = `${good.slice(0, -2)}00`;
    expect(() => parseIntelHex(`${badSum}\n${end}`)).toThrow('bad checksum (line 1)');
    expect(() => parseIntelHex(`:0400000001\n${end}`)).toThrow('the record says 4 data bytes but has 0');
    expect(() => parseIntelHex(`${record(0x7fff, 0, [1, 2])}\n${end}`)).toThrow('outside the 32 KB flash');
    expect(() => parseIntelHex(`${record(0, 7, [])}\n${end}`)).toThrow('unknown record type 7');
    expect(() => parseIntelHex(good)).toThrow('no end-of-file record');
    expect(() => parseIntelHex(`${end}\n${good}`)).toThrow('a record after the end-of-file record (line 2)');
    expect(() => parseIntelHex(`garbage\n${end}`)).toThrow('not a record (line 1)');
  });

  it('applies an extended linear address (type 04)', () => {
    expect(() => parseIntelHex([record(0, 4, [0x00, 0x01]), record(0, 0, [1]), end].join('\n'))).toThrow('outside the 32 KB flash');
  });
});
