import { describe, expect, it } from 'vitest';
import type { ProgramClock } from '../capabilities/services';
import { unoR3Board as board } from './catalog';
import { createTcs34725 } from './devices/tcs34725';
import { createVirtualUno, type I2cDevice } from './virtual-uno';

// N19 A3 (ADR 0004 §11): the virtual UNO's I²C bus in time. Each bus phase takes Wire's service (`costsUs.wirePhase`, 4.9375 µs) and
// then its SCL periods at the board's 100 kHz (10 µs each): START and STOP one, an address or data byte nine. A bus-level device hears
// each event at its time, µs since setup() began, as the parity harness's TWI adapter calls it on the board: the address and a written
// byte when they end, a read byte when it starts, the STOP when it ends.

function bench(startMs = 0) {
  let us = startMs * 1000;
  const clock: ProgramClock = { now: () => us / 1000, charge: (by) => void (us += by) };
  const uno = createVirtualUno(board, clock);
  const charged = (run: () => unknown) => {
    const before = us;
    run();
    return us - before;
  };
  return { uno, io: uno.io, charged };
}

type Call = readonly [string, number, ...unknown[]];

/** A device that logs each call with its time and answers ACK, the bytes of `reads` in turn, and NACK where it is told to. */
function recorder(options: { reads?: number[]; nackAddress?: boolean; nackByte?: number } = {}) {
  const calls: Call[] = [];
  const reads = [...(options.reads ?? [])];
  const device: I2cDevice = {
    connect: (now, read) => (calls.push(['connect', now, read]), options.nackAddress !== true),
    write: (now, byte) => (calls.push(['write', now, byte]), byte !== options.nackByte),
    read: (now) => (calls.push(['read', now]), reads.shift() ?? 0xff),
    stop: (now) => void calls.push(['stop', now]),
  };
  return { device, calls };
}

describe('the I²C bus of the virtual UNO, in time', () => {
  it('writes: START, the address (ACK), each byte, STOP, each after Wire’s service; the device hears each at its end', () => {
    const { uno, io, charged } = bench();
    const { device, calls } = recorder();
    uno.attachWireDevice(0x29, device);
    let acked = false;
    expect(charged(() => (acked = io.i2c.transmit(0x29, [0x81, 0xeb])))).toBe(314.6875);
    expect(acked).toBe(true);
    expect(calls).toEqual([
      ['connect', 109.875, false],
      ['write', 204.8125, 0x81],
      ['write', 299.75, 0xeb],
      ['stop', 314.6875],
    ]);
    expect(io.i2c.transactionUs(2, true)).toBe(314.6875);
    expect(uno.diagnostics()).toEqual([]);
  });

  it('reads: the device sends each byte when it starts, after Wire’s service; count bytes, then STOP', () => {
    const { uno, io, charged } = bench();
    const { device, calls } = recorder({ reads: [0x12, 0x34] });
    uno.attachWireDevice(0x29, device);
    let bytes: number[] = [];
    expect(charged(() => (bytes = io.i2c.request(0x29, 2)))).toBe(314.6875);
    expect(bytes).toEqual([0x12, 0x34]);
    expect(calls).toEqual([
      ['connect', 109.875, true],
      ['read', 114.8125],
      ['read', 209.75],
      ['stop', 314.6875],
    ]);
    expect([io.i2c.transactionUs(1, true), io.i2c.transactionUs(8, true)]).toEqual([219.75, 884.3125]);
  });

  it('counts the device’s time from the start of setup(): the virtual UNO’s creation, not the clock’s zero', () => {
    const { uno, io } = bench(5);
    const { device, calls } = recorder();
    uno.attachWireDevice(0x29, device);
    io.i2c.transmit(0x29, []);
    expect(calls).toEqual([
      ['connect', 109.875, false],
      ['stop', 124.8125],
    ]);
  });

  it('an address nobody acknowledges: START, address, STOP (124.8125 µs), false or no bytes, and one wire-nack warning', () => {
    const { uno, io, charged } = bench();
    let acked = true;
    expect(charged(() => (acked = io.i2c.transmit(0x29, [0xb4])))).toBe(124.8125);
    expect(acked).toBe(false);
    let bytes: number[] = [1];
    expect(charged(() => (bytes = io.i2c.request(0x29, 8)))).toBe(124.8125);
    expect(bytes).toEqual([]);
    expect(io.i2c.transactionUs(8, false)).toBe(124.8125);
    expect(uno.diagnostics()).toEqual([
      { severity: 'warning', code: 'wire-nack', address: 0x29, message: 'No I²C device answers at address 0x29: the write is not acknowledged.' },
    ]);
  });

  it('a device that refuses its address hears no byte and no STOP; one that refuses a byte gets no more, then the STOP', () => {
    const refusing = bench();
    const away = recorder({ nackAddress: true });
    refusing.uno.attachWireDevice(0x29, away.device);
    expect(refusing.charged(() => expect(refusing.io.i2c.transmit(0x29, [1, 2])).toBe(false))).toBe(124.8125);
    expect(away.calls).toEqual([['connect', 109.875, false]]);
    expect(refusing.uno.diagnostics().map((diagnostic) => [diagnostic.code, diagnostic.address])).toEqual([['wire-nack', 0x29]]);

    const picky = bench();
    const half = recorder({ nackByte: 2 });
    picky.uno.attachWireDevice(0x29, half.device);
    expect(picky.charged(() => expect(picky.io.i2c.transmit(0x29, [1, 2, 3])).toBe(false))).toBe(314.6875);
    expect(half.calls.map(([kind, , byte]) => `${kind}${byte === undefined || typeof byte === 'boolean' ? '' : ` ${String(byte)}`}`)).toEqual(['connect', 'write 1', 'write 2', 'stop']);
    expect(picky.uno.diagnostics()).toEqual([]);
  });

  it('times the whole-transaction devices of R1 the same, and wire.write / wire.read are transmit and request', () => {
    const { uno, io, charged } = bench();
    const written: number[][] = [];
    uno.attachWireDevice(0x68, { write: (bytes) => void written.push([...bytes]), read: (count) => [7, 8, 9].slice(0, count) });
    expect(charged(() => io.wire.write(0x68, [0x3b]))).toBe(219.75);
    expect(charged(() => expect(io.wire.read(0x68, 2)).toEqual([7, 8]))).toBe(314.6875);
    expect(written).toEqual([[0x3b]]);
  });

  it('refuses a read of no byte or of more than Wire’s 32-byte buffer', () => {
    const { io } = bench();
    expect(() => io.i2c.request(0x29, 0)).toThrow(/1\.\.32/);
    expect(() => io.i2c.request(0x29, 33)).toThrow(/1\.\.32/);
  });

  it('runs the TCS34725 model at 0x29: a register written is read back', () => {
    const { uno, io } = bench();
    uno.attachWireDevice(0x29, createTcs34725(() => ({ c: 0, r: 0, g: 0, b: 0 })));
    expect(io.i2c.transmit(0x29, [0x81, 0xeb])).toBe(true);
    expect(io.i2c.transmit(0x29, [0x81])).toBe(true);
    expect(io.i2c.request(0x29, 1)).toEqual([0xeb]);
    expect(io.i2c.transmit(0x29, [0x92])).toBe(true);
    expect(io.i2c.request(0x29, 1)).toEqual([0x44]);
  });

  it('has no I²C on a board that names none', () => {
    const { i2c: _none, ...plain } = board;
    let us = 0;
    const uno = createVirtualUno(plain, { now: () => us / 1000, charge: (by) => void (us += by) });
    expect(() => uno.io.i2c.transmit(0x29, [0])).toThrow(/uno-r3 has no I²C/);
    expect(_none).toBeDefined();
  });
});
