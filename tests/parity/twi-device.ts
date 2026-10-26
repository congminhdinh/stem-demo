import type { AVRTWI, CPU, TWIEventHandler } from 'avr8js';
import type { I2cDevice } from '../../src/core/hardware';

/** avr8js's AVRInterruptConfig (cpu.d.ts), which its index does not export. */
type AVRInterruptConfig = Parameters<CPU['clearInterrupt']>[0];

// The I²C bus of the emulated UNO (N19 C2, ported from the G0.2 spike spikes/avr8js/twi-device.ts; ADR 0004 §11): an avr8js 0.21.1
// TWIEventHandler that gives each bus phase the time it takes on a real bus and hands the bytes to a bus-level device (the TCS34725
// register model of src/core/hardware/devices/tcs34725.ts, the same model the virtual UNO's bus calls on the simulator's side).
//
// What avr8js does (node_modules/avr8js/dist/esm/peripherals/twi.js): a write of TWCR with TWINT and TWEN calls the handler one cycle
// later (start, stop, connectToSlave, writeByte or readByte, by TWSR's status), and the TWI waits until the handler calls
// completeStart/Stop/Connect/Write/Read, which set TWSR and TWINT (and the TWI interrupt). It has no clock of its own, so this handler
// completes each phase after its bus time.
//
// Bus time (ATmega328P datasheet 7810D–AVR–01/15 §21.5.2: SCL frequency = CPU clock / (16 + 2 · TWBR · prescaler)): one SCL period is
// 16 + 2 · TWBR · prescaler CPU cycles, read from TWBR and TWSR at each phase; Wire's twi_init() sets TWBR = 72 (100 kHz, 160 cycles).
// An address or data byte is 9 SCL periods (8 bits and the (N)ACK bit), START and STOP one each: a model choice (PLACEHOLDER until a
// logic analyser shows the part, L3), the same the virtual UNO charges (virtual-uno.ts). Each phase's time counts from the program's
// TWCR write, so TWINT rises that many cycles after it (avr8js runs the completion when the instruction under way, and any interrupt
// entry, has ended: up to 6 cycles later).
//
// One avr8js difference is corrected here, as in the spike (G0.2 ruling c3): completeStop() sets TWINT (and raises the TWI interrupt)
// when the STOP ends, where the datasheet says "Note that TWINT is NOT set after a STOP condition has been sent" (§21.6 step 7). Left
// alone, the program would run one extra TWI interrupt (TW_NO_INFO, nothing to do) per transaction that the real chip does not
// (+6.1875 µs a transaction, +12.375 µs a colorFetch: EMU-19); this handler clears it.

export type TwiPhaseKind = 'start' | 'address' | 'write' | 'read' | 'stop';
/** SCL periods of each phase. */
export const PHASE_SCL_PERIODS: Readonly<Record<TwiPhaseKind, number>> = { start: 1, address: 9, write: 9, read: 9, stop: 1 };

/** avr8js's twiConfig of the ATmega328P (twi.d.ts): TWBR 0xB8, TWSR 0xB9, TWCR 0xBC; the TWI vector at 0x30. */
const TWBR = 0xb8;
const TWSR = 0xb9;
const TWCR = 0xbc;
const TWCR_TWINT = 0x80;
const TWCR_TWIE = 0x01;
const TWI_INTERRUPT: AVRInterruptConfig = { address: 0x30, flagRegister: TWCR, flagMask: TWCR_TWINT, enableRegister: TWCR, enableMask: TWCR_TWIE };
const PRESCALERS = [1, 4, 16, 64] as const;

/** One SCL period in CPU cycles (datasheet §21.5.2). */
export const sclPeriodCycles = (twbr: number, prescaler: number): number => 16 + 2 * twbr * prescaler;

/** A transaction the bus saw: what the program addressed, whether a device answered, the data bytes. */
export type TwiTransaction = { readonly address: number; readonly read: boolean; readonly acked: boolean; readonly bytes: readonly number[] };

export class TimedTwiBus implements TWIEventHandler {
  /** Every transaction that ended with a STOP, in order. */
  readonly transactions: TwiTransaction[] = [];
  private readonly cpu: CPU;
  private readonly twi: AVRTWI;
  private readonly timeUs: (cycle: number) => number;
  private readonly devices: ReadonlyMap<number, I2cDevice>;
  private lastTwcrWrite = 0;
  private open: { address: number; read: boolean; acked: boolean; bytes: number[] } | null = null;
  private target: I2cDevice | null = null;

  /**
   * Installs itself as `twi`'s handler. `timeUs(cycle)` is the device time of a CPU cycle (µs from the start of setup(), the simulator's
   * time base); `devices` are the bus's slaves by address.
   */
  constructor(cpu: CPU, twi: AVRTWI, timeUs: (cycle: number) => number, devices: ReadonlyMap<number, I2cDevice>) {
    this.cpu = cpu;
    this.twi = twi;
    this.timeUs = timeUs;
    this.devices = devices;
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
    this.open = { address: -1, read: false, acked: false, bytes: [] };
    this.schedule('start', () => this.twi.completeStart());
  }

  stop(): void {
    this.schedule('stop', (now) => {
      this.target?.stop(now);
      this.target = null;
      this.twi.completeStop();
      // The datasheet's STOP sets no TWINT: undo avr8js's.
      this.cpu.clearInterrupt(TWI_INTERRUPT);
      if (this.open) {
        this.transactions.push(this.open);
        this.open = null;
      }
    });
  }

  connectToSlave(addr: number, write: boolean): void {
    if (this.open) {
      this.open.address = addr;
      this.open.read = !write;
    }
    this.schedule('address', (now) => {
      const device = this.devices.get(addr) ?? null;
      const ack = device?.connect(now, !write) ?? false;
      this.target = ack ? device : null;
      if (this.open) {
        this.open.acked = ack;
      }
      this.twi.completeConnect(ack);
    });
  }

  writeByte(value: number): void {
    this.schedule('write', (now) => {
      const ack = this.target?.write(now, value) ?? false;
      this.open?.bytes.push(value);
      this.twi.completeWrite(ack);
    });
  }

  readByte(): void {
    // The slave drives SDA from the byte's first bit: it is asked for the byte when the byte starts.
    const value = this.target?.read(this.timeUs(this.cpu.cycles)) ?? 0xff;
    this.schedule('read', () => {
      this.open?.bytes.push(value);
      this.twi.completeRead(value);
    });
  }

  /** Completes a phase `PHASE_SCL_PERIODS[kind]` SCL periods after the TWCR write that asked for it. */
  private schedule(kind: TwiPhaseKind, complete: (nowUs: number) => void): void {
    const busCycles = PHASE_SCL_PERIODS[kind] * this.sclCycles();
    const elapsed = this.cpu.cycles - this.lastTwcrWrite;
    this.cpu.addClockEvent(() => complete(this.timeUs(this.cpu.cycles)), busCycles - elapsed);
  }
}
