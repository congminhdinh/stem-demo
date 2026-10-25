// Intel HEX → the program memory of an ATmega328P (N18 C2; ported from spikes/avr8js/lib/uno.mjs). arduino-cli writes the
// sketch as data records (type 00), an end-of-file record (01) and, for no flash this small, no address extension; every
// record is checked against its checksum, so a truncated or edited HEX is refused instead of running half a program.

/** The ATmega328P's flash: 32 KB, read by avr8js as 16-bit words. */
export const FLASH_BYTES = 0x8000;

const RECORD = /^:([0-9A-Fa-f]{2})+$/;

/** Parses `text` (an Intel HEX file) into a flash image of FLASH_BYTES; throws on a malformed record, a bad checksum or no end. */
export function parseIntelHex(text: string): Uint16Array {
  const flash = new Uint8Array(FLASH_BYTES);
  let upper = 0;
  let ended = false;
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') {
      continue;
    }
    const where = `line ${index + 1}`;
    if (ended) {
      throw new Error(`Intel HEX: a record after the end-of-file record (${where})`);
    }
    if (!RECORD.test(line)) {
      throw new Error(`Intel HEX: not a record (${where})`);
    }
    const bytes = Uint8Array.from(line.slice(1).match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
    const count = bytes[0] ?? 0;
    if (bytes.length !== count + 5) {
      throw new Error(`Intel HEX: the record says ${count} data bytes but has ${bytes.length - 5} (${where})`);
    }
    const sum = bytes.reduce((total, byte) => (total + byte) & 0xff, 0);
    if (sum !== 0) {
      throw new Error(`Intel HEX: bad checksum (${where})`);
    }
    const address = ((bytes[1] ?? 0) << 8) | (bytes[2] ?? 0);
    const type = bytes[3];
    const data = bytes.subarray(4, 4 + count);
    if (type === 0x00) {
      const at = upper + address;
      if (at + count > FLASH_BYTES) {
        throw new Error(`Intel HEX: data at 0x${at.toString(16)} is outside the 32 KB flash (${where})`);
      }
      flash.set(data, at);
    } else if (type === 0x01) {
      ended = true;
    } else if (type === 0x02) {
      upper = (((data[0] ?? 0) << 8) | (data[1] ?? 0)) << 4;
    } else if (type === 0x04) {
      upper = (((data[0] ?? 0) << 8) | (data[1] ?? 0)) << 16;
    } else if (type !== 0x03 && type !== 0x05) {
      throw new Error(`Intel HEX: unknown record type ${String(type)} (${where})`);
    }
  }
  if (!ended) {
    throw new Error('Intel HEX: no end-of-file record');
  }
  return new Uint16Array(flash.buffer);
}
