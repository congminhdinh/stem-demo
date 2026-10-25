import {
  ADCMuxInputType,
  AVRADC,
  AVRIOPort,
  AVRTimer,
  AVRUSART,
  CPU,
  PinState,
  adcConfig,
  avrInstruction,
  portBConfig,
  portCConfig,
  portDConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  usart0Config,
} from 'avr8js';

// One emulated UNO (N18 C2, the L2e side of the parity harness; ported from spikes/avr8js/lib/uno.mjs, ADR 0003 §2): the
// ATmega328P CPU of avr8js 0.21.1 with Timer0/1/2, ports B/C/D, USART0 and the ADC, running a HEX on Node. It records every
// change of an output pin's state as avr8js reports it (`AVRIOPort.pinState`: LOW, HIGH, INPUT, INPUT_PULLUP) and every byte
// the USART starts to send, each with its cycle (µs = cycles / 16).
//
// Inputs are always the harness's (ADR 0003 §7 condition 4): avr8js models no pull-up, so a level is driven with `drive`, an
// analog value is given per conversion by `analogValue`, and nothing relies on a floating pin.
//
// `setupCycle` is the cycle at which init() of the core (wiring.c, arduino:avr 1.8.8) writes `UCSR0B = 0`, its last statement:
// main() then calls setup(). The simulator's time 0 is the start of setup() (VirtualUno), so board times are taken from there.

export const CLOCK_HZ = 16_000_000;
export const CYCLES_PER_US = CLOCK_HZ / 1_000_000;
export const usOfCycles = (cycles: number) => cycles / CYCLES_PER_US;
export const cyclesOfUs = (us: number) => Math.round(us * CYCLES_PER_US);

/** USART0's control register B (DS40002061A, register summary): init() writes 0 to it last. */
const UCSR0B = 0xc1;

export type RawPinState = 'LOW' | 'HIGH' | 'INPUT' | 'INPUT_PULLUP';
export type RawPinChange = { readonly cycle: number; readonly pin: string; readonly state: RawPinState };
export type SerialByte = { readonly cycle: number; readonly byte: number };

type PortName = 'B' | 'C' | 'D';
/** UNO header pin → ATmega328P port and bit: D0–D7 = PD0–7, D8–D13 = PB0–5, A0–A5 = PC0–5. */
export const UNO_PIN_BITS: Readonly<Record<string, { readonly port: PortName; readonly bit: number }>> = Object.fromEntries([
  ...Array.from({ length: 8 }, (_, bit) => [`D${bit}`, { port: 'D', bit }] as const),
  ...Array.from({ length: 6 }, (_, bit) => [`D${bit + 8}`, { port: 'B', bit }] as const),
  ...Array.from({ length: 6 }, (_, bit) => [`A${bit}`, { port: 'C', bit }] as const),
]);

const stateNames: Readonly<Record<PinState, RawPinState>> = {
  [PinState.Low]: 'LOW',
  [PinState.High]: 'HIGH',
  [PinState.Input]: 'INPUT',
  [PinState.InputPullUp]: 'INPUT_PULLUP',
};

export class EmulatedUno {
  readonly cpu: CPU;
  /** Every change of a pin's state, in cycle order. */
  readonly changes: RawPinChange[] = [];
  /** Every byte the USART started to send. */
  readonly serial: SerialByte[] = [];
  /** The cycle of init()'s last statement (`UCSR0B = 0`): setup() starts right after it. Null until it ran. */
  setupCycle: number | null = null;
  /** The ADC value (0..1023) a conversion of an analog pin gives; 0 when nothing says otherwise. */
  analogValue: (pin: string) => number = () => 0;
  /** The time one byte takes on the USART line, in cycles (UBRR0 = 207 with U2X at 9600 baud: 10 bits). */
  get serialFrameCycles(): number {
    return this.frameCycles;
  }

  private readonly ports: Readonly<Record<PortName, AVRIOPort>>;
  private readonly adc: AVRADC;
  private readonly usart: AVRUSART;
  private readonly pinListeners: ((change: RawPinChange) => void)[] = [];
  private readonly setupListeners: (() => void)[] = [];
  private frameCycles = 0;

  constructor(flash: Uint16Array) {
    const cpu = new CPU(flash);
    this.cpu = cpu;
    for (const config of [timer0Config, timer1Config, timer2Config]) {
      new AVRTimer(cpu, config);
    }
    this.ports = { B: new AVRIOPort(cpu, portBConfig), C: new AVRIOPort(cpu, portCConfig), D: new AVRIOPort(cpu, portDConfig) };
    this.usart = new AVRUSART(cpu, usart0Config, CLOCK_HZ);
    this.adc = new AVRADC(cpu, adcConfig);

    this.adc.onADCRead = (input) => {
      const pin = input.type === ADCMuxInputType.SingleEnded ? `A${input.channel}` : null;
      const value = pin === null ? 0 : this.analogValue(pin);
      if (!Number.isInteger(value) || value < 0 || value > 1023) {
        throw new RangeError(`An ADC value is an integer 0..1023, not ${String(value)} (${String(pin)})`);
      }
      cpu.addClockEvent(() => this.adc.completeADCRead(value), this.adc.sampleCycles);
    };

    for (const [name, port] of Object.entries(this.ports) as [PortName, AVRIOPort][]) {
      const pins = Object.entries(UNO_PIN_BITS).filter(([, where]) => where.port === name);
      const last = new Map(pins.map(([pin, { bit }]) => [pin, stateNames[port.pinState(bit)]]));
      port.addListener(() => {
        for (const [pin, { bit }] of pins) {
          const state = stateNames[port.pinState(bit)];
          if (state !== last.get(pin)) {
            last.set(pin, state);
            const change = { cycle: cpu.cycles, pin, state };
            this.changes.push(change);
            for (const listener of this.pinListeners) {
              listener(change);
            }
          }
        }
      });
    }

    this.usart.onByteTransmit = (byte) => void this.serial.push({ cycle: cpu.cycles, byte });
    this.usart.onConfigurationChange = () => {
      // 1 start + 8 data + 1 stop bits, (UBRR + 1) · 8 cycles each with U2X (the core sets U2X0 for 9600 baud).
      this.frameCycles = Math.round((CLOCK_HZ / this.usart.baudRate) * (1 + this.usart.bitsPerChar + this.usart.stopBits));
    };
    const usartHook = cpu.writeHooks[UCSR0B];
    cpu.writeHooks[UCSR0B] = (value, oldValue, address, mask) => {
      if (this.setupCycle === null) {
        this.setupCycle = cpu.cycles;
        for (const listener of this.setupListeners) {
          listener();
        }
      }
      return usartHook?.(value, oldValue, address, mask);
    };
  }

  /** Calls `listener` on every recorded pin change. */
  onPin(listener: (change: RawPinChange) => void): void {
    this.pinListeners.push(listener);
  }

  /** Calls `listener` once, when init() ends and setup() starts. */
  onSetup(listener: () => void): void {
    this.setupListeners.push(listener);
  }

  /** Drives an input pin from outside (a button, a line sensor, an echo): the level its PIN bit reads. */
  drive(pin: string, high: boolean): void {
    const where = UNO_PIN_BITS[pin];
    if (!where) {
      throw new RangeError(`No pin ${pin} on the UNO`);
    }
    this.ports[where.port].setPin(where.bit, high);
  }

  /** Runs `task` when the cycle counter reaches `cycle` (at once if it has). */
  at(cycle: number, task: () => void): void {
    this.cpu.addClockEvent(task, Math.max(0, cycle - this.cpu.cycles));
  }

  /** Runs until the cycle counter reaches `cycle`. */
  runUntil(cycle: number): void {
    const { cpu } = this;
    while (cpu.cycles < cycle) {
      avrInstruction(cpu);
      cpu.tick();
    }
  }
}
