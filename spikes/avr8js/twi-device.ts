import type { AVRTWI, CPU, TWIEventHandler } from 'avr8js';

/** avr8js's AVRInterruptConfig (cpu.d.ts), which its index does not export. */
type AVRInterruptConfig = Parameters<CPU['clearInterrupt']>[0];

// The I²C bus of the emulated UNO (N19 G0.2): an avr8js 0.21.1 TWIEventHandler that gives each bus phase the time it takes on a
// real bus and hands the bytes to TS slave models (the TCS34725 of tcs34725-model.ts). Task C2 moves it to tests/parity/.
//
// What avr8js does (node_modules/avr8js/dist/esm/peripherals/twi.js, read 2026-10-26): a write of TWCR with TWINT and TWEN calls
// the handler one cycle later (start, stop, connectToSlave, writeByte or readByte, chosen by TWSR's status), and the TWI waits
// until the handler calls completeStart/Stop/Connect/Write/Read, which set TWSR and TWINT (and the TWI interrupt). It has no
// clock of its own: NoopTWIEventHandler completes everything at once. So this handler completes each phase after its bus time.
//
// Bus time (ATmega328P datasheet 7810D–AVR–01/15 §21.5.2 "Bit Rate Generator Unit": SCL frequency = CPU clock / (16 + 2 · TWBR ·
// prescaler)): one SCL period is 16 + 2 · TWBR · prescaler CPU cycles, read from TWBR and TWSR at each phase. Wire's twi_init()
// (arduino:avr 1.8.8, libraries/Wire/src/utility/twi.c) sets TWBR = ((F_CPU / TWI_FREQ) − 16) / 2 = 72 with prescaler 1: 160
// cycles = 10 µs, 100 kHz. An address or data byte is 9 SCL periods (8 bits and the (N)ACK bit, 90 µs). START and STOP are each
// one SCL period: a model choice (PLACEHOLDER until a logic analyser shows the part, L3), just above the datasheet's minimums for
// fSCL ≤ 100 kHz (Table 28-7: tSU;STA 4.7 + tHD;STA 4.0 µs; tSU;STO 4.0 + tBUF 4.7 µs). Each phase's time counts from the
// program's TWCR write, so TWINT rises that many cycles after it (avr8js runs the completion when the instruction under way, and
// any interrupt entry, has ended: up to 6 cycles later; 5 measured).
//
// One avr8js difference is corrected here: completeStop() sets TWINT (and raises the TWI interrupt) when the STOP ends, where the
// datasheet says "Note that TWINT is NOT set after a STOP condition has been sent" (§21.6 step 7). Left alone, the program would run
// one extra TWI interrupt (TW_NO_INFO, nothing to do) per transaction that the real chip does not; this handler clears it.

/** An I²C slave on the bus, called at the bus time (µs) of each event. */
export type I2cDevice = {
  readonly address: number;
  /** The master sent this address after a START: true = ACK. Called when the address byte ends. */
  connect(nowUs: number, read: boolean): boolean;
  /** A byte the master wrote: true = ACK. Called when the byte ends. */
  write(nowUs: number, byte: number): boolean;
  /** The byte the slave sends. Called when the byte starts (the slave drives SDA from its first bit). */
  read(nowUs: number): number;
  stop(nowUs: number): void;
};

export type TwiPhaseKind = 'start' | 'address' | 'write' | 'read' | 'stop';
/** SCL periods of each phase. */
export const PHASE_SCL_PERIODS: Readonly<Record<TwiPhaseKind, number>> = { start: 1, address: 9, write: 9, read: 9, stop: 1 };

export type TwiPhase = {
  readonly kind: TwiPhaseKind;
  /** The cycle of the program's TWCR write that asked for it. */
  readonly requestCycle: number;
  /** The cycle at which it completed (TWINT set, or TWSTO cleared for a STOP). */
  readonly doneCycle: number;
  /** Its bus time by the model, cycles. */
  readonly busCycles: number;
  readonly byte?: number;
  readonly ack?: boolean;
};

export type TwiTransaction = {
  /** The cycle of the TWCR write with TWSTA. */
  readonly startCycle: number;
  /** The cycle at which its STOP ended, or at which the program asked for the repeated START that ended it. */
  readonly stopCycle: number;
  readonly endedBy: 'stop' | 'repeated-start';
  readonly address: number;
  readonly read: boolean;
  /** Whether a device acknowledged the address. */
  readonly acked: boolean;
  /** The data bytes, written or read (not the address). */
  readonly bytes: readonly number[];
  readonly phases: readonly TwiPhase[];
};

/** One SCL period in CPU cycles (datasheet §21.5.2). */
export function sclPeriodCycles(twbr: number, prescaler: number): number {
  return 16 + 2 * twbr * prescaler;
}

/** The bus time of a transaction by the model: START, the address, its data bytes, STOP. */
export function transactionBusCycles(dataBytes: number, sclCycles: number, acked = true): number {
  const bytes = acked ? dataBytes : 0;
  return (PHASE_SCL_PERIODS.start + PHASE_SCL_PERIODS.address + bytes * PHASE_SCL_PERIODS.write + PHASE_SCL_PERIODS.stop) * sclCycles;
}

/** avr8js's twiConfig of the ATmega328P (twi.d.ts): TWBR 0xB8, TWSR 0xB9, TWCR 0xBC; the TWI vector at 0x30. */
const TWBR = 0xb8;
const TWSR = 0xb9;
const TWCR = 0xbc;
const TWCR_TWINT = 0x80;
const TWCR_TWIE = 0x01;
const TWI_INTERRUPT: AVRInterruptConfig = { address: 0x30, flagRegister: TWCR, flagMask: TWCR_TWINT, enableRegister: TWCR, enableMask: TWCR_TWIE };
const PRESCALERS = [1, 4, 16, 64] as const;

type Pending = { kind: TwiPhaseKind; requestCycle: number; busCycles: number; byte?: number };
type Open = { startCycle: number; address: number; read: boolean; acked: boolean; bytes: number[]; phases: TwiPhase[] };

export class TimedTwiBus implements TWIEventHandler {
  /** Every transaction that ended with a STOP, in order. */
  readonly transactions: TwiTransaction[] = [];
  private readonly cpu: CPU;
  private readonly twi: AVRTWI;
  private readonly timeUs: (cycle: number) => number;
  private readonly devices: Map<number, I2cDevice>;
  private lastTwcrWrite = 0;
  private open: Open | null = null;
  private target: I2cDevice | null = null;
  private readonly keepStopInterrupt: boolean;

  /**
   * Installs itself as `twi`'s handler. `timeUs(cycle)` is the device time of a CPU cycle (µs from the start of setup(), the
   * simulator's time base). `keepStopInterrupt` leaves avr8js's TWINT after a STOP in place (only to measure what it costs).
   */
  constructor(cpu: CPU, twi: AVRTWI, timeUs: (cycle: number) => number, devices: readonly I2cDevice[], options: { keepStopInterrupt?: boolean } = {}) {
    this.keepStopInterrupt = options.keepStopInterrupt ?? false;
    this.cpu = cpu;
    this.twi = twi;
    this.timeUs = timeUs;
    this.devices = new Map(devices.map((device) => [device.address, device]));
    twi.eventHandler = this;
    const hook = cpu.writeHooks[TWCR];
    cpu.writeHooks[TWCR] = (value, oldValue, address, mask) => {
      this.lastTwcrWrite = cpu.cycles;
      return hook?.(value, oldValue, address, mask);
    };
  }

  /** One SCL period now, from TWBR and TWSR's prescaler bits. */
  sclCycles(): number {
    return sclPeriodCycles(this.cpu.data[TWBR] ?? 0, PRESCALERS[(this.cpu.data[TWSR] ?? 0) & 0x03] ?? 1);
  }

  start(): void {
    if (this.open) {
      const { open } = this;
      this.transactions.push({ startCycle: open.startCycle, stopCycle: this.lastTwcrWrite, endedBy: 'repeated-start', address: open.address, read: open.read, acked: open.acked, bytes: open.bytes, phases: open.phases });
    }
    this.open = { startCycle: this.lastTwcrWrite, address: -1, read: false, acked: false, bytes: [], phases: [] };
    this.schedule('start', undefined, () => {
      this.twi.completeStart();
      return {};
    });
  }

  stop(): void {
    this.schedule('stop', undefined, (now) => {
      this.target?.stop(now);
      this.target = null;
      this.twi.completeStop();
      // The datasheet's STOP sets no TWINT: undo avr8js's.
      if (!this.keepStopInterrupt) {
        this.cpu.clearInterrupt(TWI_INTERRUPT);
      }
      return {};
    });
  }

  connectToSlave(addr: number, write: boolean): void {
    if (this.open) {
      this.open.address = addr;
      this.open.read = !write;
    }
    this.schedule('address', (addr << 1) | (write ? 0 : 1), (now) => {
      const device = this.devices.get(addr) ?? null;
      const ack = device?.connect(now, !write) ?? false;
      this.target = ack ? device : null;
      if (this.open) {
        this.open.acked = ack;
      }
      this.twi.completeConnect(ack);
      return { ack };
    });
  }

  writeByte(value: number): void {
    this.schedule('write', value, (now) => {
      const ack = this.target?.write(now, value) ?? false;
      this.open?.bytes.push(value);
      this.twi.completeWrite(ack);
      return { ack };
    });
  }

  readByte(ack: boolean): void {
    const value = this.target?.read(this.timeUs(this.cpu.cycles)) ?? 0xff;
    this.schedule('read', value, () => {
      this.open?.bytes.push(value);
      this.twi.completeRead(value);
      return { ack };
    });
  }

  /** Completes a phase `PHASE_SCL_PERIODS[kind]` SCL periods after the TWCR write that asked for it. */
  private schedule(kind: TwiPhaseKind, byte: number | undefined, complete: (nowUs: number) => { ack?: boolean }): void {
    const pending: Pending = { kind, requestCycle: this.lastTwcrWrite, busCycles: PHASE_SCL_PERIODS[kind] * this.sclCycles(), byte };
    const elapsed = this.cpu.cycles - pending.requestCycle;
    this.cpu.addClockEvent(() => {
      const doneCycle = this.cpu.cycles;
      const { ack } = complete(this.timeUs(doneCycle));
      const phase: TwiPhase = { kind, requestCycle: pending.requestCycle, doneCycle, busCycles: pending.busCycles, ...(byte === undefined ? {} : { byte }), ...(ack === undefined ? {} : { ack }) };
      const open = this.open;
      open?.phases.push(phase);
      if (kind === 'stop' && open) {
        this.transactions.push({ startCycle: open.startCycle, stopCycle: doneCycle, endedBy: 'stop', address: open.address, read: open.read, acked: open.acked, bytes: open.bytes, phases: open.phases });
        this.open = null;
      }
    }, pending.busCycles - elapsed);
  }
}
