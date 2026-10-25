// TEST-ONLY (N18 C1): the arithmetic of contract UNO §3.1, written from the contract's own words with BigInt, independently of the
// simulator's values.ts (`| 0`, Math.imul): + − × and negation wrap modulo 2^32; / truncates toward zero, INT32_MIN / -1 is INT32_MIN,
// x / 0 is 0; % has the sign of the dividend, x % -1 is 0, x % 0 is 0; a truth value prints 1 / 0. It is what the helpers add32…mod32
// compute on the board (EMU-10/11/13), so the parity test can say what a golden must print.

const wrap = (value: bigint): number => Number(BigInt.asIntN(32, value));

export const add32 = (a: number, b: number) => wrap(BigInt(a) + BigInt(b));
export const sub32 = (a: number, b: number) => wrap(BigInt(a) - BigInt(b));
export const mul32 = (a: number, b: number) => wrap(BigInt(a) * BigInt(b));
export const neg32 = (a: number) => wrap(-BigInt(a));
/** BigInt division truncates toward zero, as C++'s does. */
export const div32 = (a: number, b: number) => (b === -1 ? neg32(a) : b === 0 ? 0 : wrap(BigInt(a) / BigInt(b)));
/** BigInt's remainder has the sign of the dividend, as C++'s does. */
export const mod32 = (a: number, b: number) => (b === -1 || b === 0 ? 0 : wrap(BigInt(a) % BigInt(b)));
/** What Serial.print writes for a value: its decimal digits, or 1 / 0 for a truth value (contract §3.1, §7). */
export const printed = (value: number | boolean): string => (typeof value === 'boolean' ? (value ? '1' : '0') : String(value));

export const INT32_MIN = -2_147_483_648;
export const INT32_MAX = 2_147_483_647;
