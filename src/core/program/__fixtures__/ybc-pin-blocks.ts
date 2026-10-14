import { chain, type Json } from './ybc-blocks';

// Builders for the Blockly serialization JSON of the header-pin blocks (YB-4, tests only), in the shape
// Blockly itself saves (tests/ybc-pins-conformance.test.ts checks that against real Blockly): a dropdown is
// its option's value, so a pin is "P0" and a level is "1" (ON) or "0" (OFF).

let counter = 0;
const id = (type: string) => `${type}-${++counter}`;

/** "set pin P to ON / OFF" (C-23). */
export const pinWrite = (pin: string, on: boolean): Json => ({ type: 'ybc_pin_write', id: id('pin-write'), fields: { PIN: pin, LEVEL: on ? '1' : '0' } });
/** "digital read pin P" (C-24): a true / false value. */
export const pinRead = (pin: string): Json => ({ type: 'ybc_pin_read', id: id('pin-read'), fields: { PIN: pin } });
/** "analog read pin P" (C-25): a whole number 0..4095. */
export const pinAnalog = (pin: string): Json => ({ type: 'ybc_pin_analog', id: id('pin-analog'), fields: { PIN: pin } });

export { chain };
