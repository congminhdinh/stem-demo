// The TCS34725 colour sensor as a register model (N19 plan §4.4 and D-G7; ADR 0004 §11). Written in the G0.2 spike
// (spikes/avr8js/tcs34725-model.ts) and moved here by task A3 with its behaviour unchanged: it imports nothing and uses only
// + × / floor, so it runs the same on every engine. One model serves both sides of the parity harness: the board (the HEX on
// avr8js, through the TWI adapter, which calls it at the bus time of each byte) and the simulator (the virtual UNO's I²C bus,
// virtual-uno.ts, which calls it at the program time of each byte, attached with `attachWireDevice(0x29, …)`).
//
// Source: TCS3472 datasheet TAOS135, August 2012 (ams/TAOS; sha256 acf25844… of cdn-shop.adafruit.com/datasheets/TCS34725.pdf):
// - Table 3, register set and reset values; Table 4, the command byte (CMD bit 7, TYPE bits 6:5: 00 repeated byte, 01
//   auto-increment, 11 special function; ADDR/SF bits 4:0); Table 5, ENABLE (PON bit 0, AEN bit 1, WEN bit 3, AIEN bit 4);
//   Table 6, ATIME: integration time 2.4 ms × (256 − ATIME), "Max RGBC Count = (256 − ATIME) × 1024 up to a maximum of 65535";
//   Table 11, CONTROL AGAIN 1×/4×/16×/60×; Table 12, ID 0x44 for the TCS34725; Table 13, STATUS (AVALID bit 0, AINT bit 4).
// - "I2C Protocol": the first byte written is the command byte; "if the MSB of the command is not set, the device will write a
//   series of bytes at the address stored in the last valid command"; a read uses the address of the previous command.
// - Figure 9 and "System Timing": with AEN the device runs Wait (only with WEN) → RGBC Init (2.4 ms) → RGBC ADC (ATIME) and
//   "upon completion and return to Idle, the device will automatically begin a new Wait-RGBC cycle". So every cycle has its
//   2.4 ms Init: with ATIME 0xEB a new window ends every 52.8 ms, not 50.4. Note 2 of Table 5: "A minimum interval of 2.4 ms must
//   pass after PON is asserted before an RGBC can be initiated."
// - "RGBC Channel Data Registers": "when the lower byte register is read, the upper eight bits are stored into a shadow
//   register, which is read by a subsequent read to the upper byte".
//
// Model choices the datasheet does not settle (PLACEHOLDER until a real part is measured, VG/L3):
// - Time is nominal: 2.4 ms per step (the part's oscillator gives 2.27…2.56 ms, Optical Characteristics).
// - ATIME and AGAIN are latched when a window's ADC starts; a later write applies from the next window.
// - AVALID is set when a window ends and cleared when AEN goes from 0 to 1. AINT, thresholds and persistence are not modelled
//   (AINT reads 0; the program never reads it). The clear-interrupt special function is acknowledged and does nothing.
// - Turning AEN or PON off drops the window under way; the data registers keep their last values.
// - The register address wraps within its 5 bits on auto-increment.
//
// Light: the caller says how much light reached each photodiode over a span of time (an integral, so the counts of a window do
// not depend on when the program reads it): `counts = min(1024 · cycles, 65535, floor(gain × integral / 10^6))`.

export const TCS34725_ADDRESS = 0x29;
export const TCS34725_ID = 0x44;
/** One integration step and the RGBC Init state, µs (datasheet: 2.4 ms). */
export const TCS_STEP_US = 2400;
/** Integration steps of the Wait state with WLONG set (WTIME × 12, Table 7 and CONFIG). */
const WLONG_FACTOR = 12;

export const TCS_REGISTER = {
  ENABLE: 0x00,
  ATIME: 0x01,
  WTIME: 0x03,
  AILTL: 0x04,
  AILTH: 0x05,
  AIHTL: 0x06,
  AIHTH: 0x07,
  PERS: 0x0c,
  CONFIG: 0x0d,
  CONTROL: 0x0f,
  ID: 0x12,
  STATUS: 0x13,
  CDATAL: 0x14,
  CDATAH: 0x15,
  RDATAL: 0x16,
  RDATAH: 0x17,
  GDATAL: 0x18,
  GDATAH: 0x19,
  BDATAL: 0x1a,
  BDATAH: 0x1b,
} as const;

export const TCS_ENABLE = { PON: 0x01, AEN: 0x02, WEN: 0x08, AIEN: 0x10 } as const;
export const TCS_COMMAND = { CMD: 0x80, TYPE_MASK: 0x60, REPEATED: 0x00, AUTO_INCREMENT: 0x20, SPECIAL: 0x60, ADDRESS_MASK: 0x1f } as const;
export const TCS_STATUS_AVALID = 0x01;
const CONFIG_WLONG = 0x02;
/** AGAIN (CONTROL bits 1:0) → gain. */
export const TCS_GAINS: readonly number[] = [1, 4, 16, 60];

/** Per channel: clear, red, green, blue. */
export type Rgbc = { readonly c: number; readonly r: number; readonly g: number; readonly b: number };

/**
 * The light on the photodiodes over [fromUs, toUs): per channel, the irradiance integrated over time, in counts per second at
 * 1× gain times µs (N counts per second for d µs is N·d). Non-negative safe integers, so a window's counts are exact.
 */
export type LightIntegral = (fromUs: number, toUs: number) => Rgbc;

/** The registers as a read would see them now (tests and the inspector; reading them here latches nothing). */
export type TcsRegisters = {
  readonly enable: number;
  readonly atime: number;
  readonly control: number;
  readonly status: number;
  readonly id: number;
  /** The counts of the last window that ended (0 before the first). */
  readonly data: Rgbc;
  /** When the next window ends, µs; null when the RGBC is not running. */
  readonly nextWindowEndUs: number | null;
};

/** The device as an I²C slave: what the master does on the bus, each at the time it happens. */
export type Tcs34725 = {
  readonly address: number;
  /** The master sent this device's address after a (repeated) START; it acknowledges. */
  connect(nowUs: number, read: boolean): boolean;
  /** A byte the master wrote; true = ACK (the device acknowledges every byte). */
  write(nowUs: number, byte: number): boolean;
  /** The byte the device sends for the master's next read. */
  read(nowUs: number): number;
  /** A STOP condition. */
  stop(nowUs: number): void;
  peek(nowUs: number): TcsRegisters;
};

const ZERO: Rgbc = { c: 0, r: 0, g: 0, b: 0 };
/** Data registers: the channel of each low byte, from CDATAL. */
const DATA_LOW: Readonly<Record<number, keyof Rgbc>> = {
  [TCS_REGISTER.CDATAL]: 'c',
  [TCS_REGISTER.RDATAL]: 'r',
  [TCS_REGISTER.GDATAL]: 'g',
  [TCS_REGISTER.BDATAL]: 'b',
};
/** Registers a write changes (Table 3: R/W); the others are read-only or reserved. */
const WRITABLE = new Set<number>([
  TCS_REGISTER.ENABLE,
  TCS_REGISTER.ATIME,
  TCS_REGISTER.WTIME,
  TCS_REGISTER.AILTL,
  TCS_REGISTER.AILTH,
  TCS_REGISTER.AIHTL,
  TCS_REGISTER.AIHTH,
  TCS_REGISTER.PERS,
  TCS_REGISTER.CONFIG,
  TCS_REGISTER.CONTROL,
]);
const ENABLE_BITS = TCS_ENABLE.PON | TCS_ENABLE.AEN | TCS_ENABLE.WEN | TCS_ENABLE.AIEN;

/** floor(a / b) for non-negative safe integers, exact (a float division alone may round up to the next integer). */
function floorDiv(a: number, b: number): number {
  let q = Math.floor(a / b);
  while (q * b > a) {
    q -= 1;
  }
  while ((q + 1) * b <= a) {
    q += 1;
  }
  return q;
}

/** The counts of one window: the light it integrated, the gain and the ceiling of its length (Table 6). */
export function windowCounts(light: Rgbc, gain: number, cycles: number): Rgbc {
  const ceiling = Math.min(1024 * cycles, 65535);
  const count = (integral: number) => {
    if (!Number.isSafeInteger(integral) || integral < 0) {
      throw new RangeError(`A light integral is a non-negative safe integer, not ${String(integral)}`);
    }
    return Math.min(ceiling, floorDiv(gain * integral, 1_000_000));
  };
  return { c: count(light.c), r: count(light.r), g: count(light.g), b: count(light.b) };
}

type Cycle = {
  /** When its RGBC Init starts (after any Wait). */
  initUs: number;
  /** ATIME and gain, latched when its ADC starts; null until then. */
  latched: { cycles: number; gain: number } | null;
};

export function createTcs34725(light: LightIntegral): Tcs34725 {
  const regs = new Uint8Array(0x20);
  regs[TCS_REGISTER.ATIME] = 0xff;
  regs[TCS_REGISTER.WTIME] = 0xff;
  regs[TCS_REGISTER.ID] = TCS34725_ID;
  let data: Rgbc = ZERO;
  const shadow = { c: 0, r: 0, g: 0, b: 0 };
  let avalid = false;
  let ponAtUs: number | null = null;
  let cycle: Cycle | null = null;
  // The command state: the register address, auto-increment, and whether the next written byte is the command byte.
  let pointer = 0;
  let autoIncrement = false;
  let expectCommand = false;
  let lastUs = Number.NEGATIVE_INFINITY;

  const waitUs = () => {
    if ((regs[TCS_REGISTER.ENABLE] ?? 0) & TCS_ENABLE.WEN) {
      const steps = 256 - (regs[TCS_REGISTER.WTIME] ?? 0xff);
      return steps * TCS_STEP_US * ((regs[TCS_REGISTER.CONFIG] ?? 0) & CONFIG_WLONG ? WLONG_FACTOR : 1);
    }
    return 0;
  };
  const adcStartUs = (c: Cycle) => c.initUs + TCS_STEP_US;

  /** Runs the state machine up to `nowUs`: latches each window's settings when its ADC starts and stores its counts when it ends. */
  const advance = (nowUs: number) => {
    if (!Number.isFinite(nowUs) || nowUs < lastUs) {
      throw new RangeError(`The TCS34725 model runs forward in time: ${String(nowUs)} µs after ${String(lastUs)} µs`);
    }
    lastUs = nowUs;
    while (cycle !== null) {
      if (cycle.latched === null) {
        if (nowUs < adcStartUs(cycle)) {
          return;
        }
        const atime = regs[TCS_REGISTER.ATIME] ?? 0xff;
        cycle.latched = { cycles: 256 - atime, gain: TCS_GAINS[(regs[TCS_REGISTER.CONTROL] ?? 0) & 0x03] ?? 1 };
      }
      const from = adcStartUs(cycle);
      const to = from + cycle.latched.cycles * TCS_STEP_US;
      if (nowUs < to) {
        return;
      }
      data = windowCounts(light(from, to), cycle.latched.gain, cycle.latched.cycles);
      avalid = true;
      cycle = { initUs: to + waitUs(), latched: null };
    }
  };

  const writeEnable = (nowUs: number, value: number) => {
    const before = regs[TCS_REGISTER.ENABLE] ?? 0;
    const after = value & ENABLE_BITS;
    regs[TCS_REGISTER.ENABLE] = after;
    const on = (bits: number, mask: number) => (bits & mask) === mask;
    if (!on(after, TCS_ENABLE.PON)) {
      ponAtUs = null;
      cycle = null;
      return;
    }
    if (!on(before, TCS_ENABLE.PON)) {
      ponAtUs = nowUs;
    }
    if (!on(after, TCS_ENABLE.AEN)) {
      cycle = null;
      return;
    }
    if (cycle === null) {
      if (!on(before, TCS_ENABLE.AEN)) {
        avalid = false;
      }
      // The RGBC starts once PON has been on for 2.4 ms (Table 5, note 2); a Wait comes first with WEN (Figure 9).
      const start = Math.max(nowUs, (ponAtUs ?? nowUs) + TCS_STEP_US);
      cycle = { initUs: start + waitUs(), latched: null };
    }
  };

  const readRegister = (address: number): number => {
    const channel = DATA_LOW[address];
    if (channel !== undefined) {
      const value = data[channel];
      shadow[channel] = (value >> 8) & 0xff;
      return value & 0xff;
    }
    switch (address) {
      case TCS_REGISTER.CDATAH:
        return shadow.c;
      case TCS_REGISTER.RDATAH:
        return shadow.r;
      case TCS_REGISTER.GDATAH:
        return shadow.g;
      case TCS_REGISTER.BDATAH:
        return shadow.b;
      case TCS_REGISTER.STATUS:
        return avalid ? TCS_STATUS_AVALID : 0;
      default:
        return regs[address] ?? 0;
    }
  };

  const step = () => {
    if (autoIncrement) {
      pointer = (pointer + 1) & TCS_COMMAND.ADDRESS_MASK;
    }
  };

  return {
    address: TCS34725_ADDRESS,
    connect(nowUs, read) {
      advance(nowUs);
      expectCommand = !read;
      return true;
    },
    write(nowUs, byte) {
      advance(nowUs);
      if (expectCommand && byte & TCS_COMMAND.CMD) {
        expectCommand = false;
        const type = byte & TCS_COMMAND.TYPE_MASK;
        if (type === TCS_COMMAND.SPECIAL) {
          return true;
        }
        pointer = byte & TCS_COMMAND.ADDRESS_MASK;
        autoIncrement = type === TCS_COMMAND.AUTO_INCREMENT;
        return true;
      }
      expectCommand = false;
      if (pointer === TCS_REGISTER.ENABLE) {
        writeEnable(nowUs, byte);
      } else if (WRITABLE.has(pointer)) {
        regs[pointer] = byte & 0xff;
      }
      step();
      return true;
    },
    read(nowUs) {
      advance(nowUs);
      const value = readRegister(pointer);
      step();
      return value;
    },
    stop(nowUs) {
      advance(nowUs);
      expectCommand = false;
    },
    peek(nowUs) {
      advance(nowUs);
      let nextWindowEndUs: number | null = null;
      if (cycle !== null) {
        const cycles = cycle.latched?.cycles ?? 256 - (regs[TCS_REGISTER.ATIME] ?? 0xff);
        nextWindowEndUs = adcStartUs(cycle) + cycles * TCS_STEP_US;
      }
      return {
        enable: regs[TCS_REGISTER.ENABLE] ?? 0,
        atime: regs[TCS_REGISTER.ATIME] ?? 0,
        control: regs[TCS_REGISTER.CONTROL] ?? 0,
        status: avalid ? TCS_STATUS_AVALID : 0,
        id: regs[TCS_REGISTER.ID] ?? 0,
        data,
        nextWindowEndUs,
      };
    },
  };
}
