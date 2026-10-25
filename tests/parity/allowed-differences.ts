import { unoContract } from '../../src/core/compat/uno-contract';
import { unoR3Board } from '../../src/core/hardware';

// The differences the parity harness allows between the simulator (L1) and the HEX on avr8js (L2e), as data (N18 C2; ADR 0003
// §7 condition 2). Each entry says why the two sides differ and where the contract or the ADR records it; its numbers are the
// measured ones (spikes/avr8js/out/results.json, the contract's data, or this harness's own trace, `pnpm test
// tests/uno-emulator-parity.test.ts`). The comparator (compare.ts) and the board decoder (board-trace.ts) apply them by id; no
// test body has a tolerance of its own.
//
// The rule they extend (ADR 0003 §7 condition 1): events and Serial values, never cycles; an interval of 1 ms or more matches
// within ±1 %; a shorter one within the cost shift of the program's own build (ADR §4, contract §4.4: the costs table is of the
// calls the compiler did not fold).

const costs = unoContract.costsUs;
const cycleUs = 1e6 / unoContract.board.clockHz;

export type AllowedDifference = {
  /** Why the two sides differ. */
  readonly reason: string;
  /** Where it is recorded: contract sections and rows, ADR sections, evidence ids. */
  readonly refs: readonly string[];
};

export const intervalRule = {
  reason: 'An interval of 1 ms or more matches within ±1 %; a shorter one is a run of short calls (ADR 0003 §7 condition 1).',
  refs: ['ADR 0003 §7.1', 'contract §4.4 (Độ lệch theo chương trình)', 'contract §13 (Chi phí lệnh ngắn)'],
  longFromUs: 1000,
  longShare: 0.01,
} as const satisfies AllowedDifference & Record<string, unknown>;

export const allowedDifferences = {
  'timer0-duty': {
    reason: 'avr8js gives Timer0 fast PWM (D5, D6) a HIGH time of v/256 of the period; the simulator models v/255 (the board, per datasheet, (v+1)/256). The board decoder reads a Timer0 duty on the 256 scale.',
    refs: ['ADR 0003 §6.1', 'contract §5.1', 'contract §13 (Duty D5/D6)', 'EMU-02', 'EMU-06'],
    timer: 'T0',
    scale: 256,
    otherScale: unoR3Board.pwmMax,
  },
  'usart-frame': {
    reason: 'avr8js sends one byte every 1044.17 µs (UDR and the shift register are one), the board 1040 µs. The harness drains its model of the TX queue at the avr8js rate.',
    refs: ['ADR 0003 §6.2', 'contract §7', 'contract §13 (USART)', 'EMU-08'],
    frameUs: 1044.17,
    boardFrameUs: costs.serialLineByte,
  },
  'tx-queue': {
    reason: 'avr8js holds 64 bytes in the TX queue before Serial.write blocks (the board, with its separate shift register, 65).',
    refs: ['ADR 0003 §6.2', 'contract §7', 'contract §13 (USART)', 'EMU-08'],
    bytes: unoContract.constants.SERIAL_TX_QUEUE_BYTES,
  },
  'pull-up': {
    reason: 'avr8js models no pull-up: a floating INPUT_PULLUP pin reads LOW. The harness drives every input pin of the kit, a pull-up pin HIGH unless the fixture presses it (inputs.ts).',
    refs: ['ADR 0003 §6.3', 'ADR 0003 §7.4', 'contract §6.4', 'contract §13 (Chân thả nổi / pull-up)'],
    releasedLevel: 1,
  },
  'isr-load': {
    reason: 'The simulator charges no interrupt time; on the board the Timer0 overflow (millis), each Servo and a playing tone take cycles from the program. It fits the ±1 % of a long interval except for a tone; a short interval can hold one interrupt of each source.',
    refs: ['contract §4.5', 'contract §13 (Tải ngắt)', 'EMU-08'],
    timer0IsrUs: 95.44 * cycleUs,
    timer0PeriodUs: unoContract.millis.overflowUs,
    servoFrameUs: 2601 * cycleUs / 5,
    toneIsrUs: 119.19 * cycleUs,
    toneSharePerHz: unoContract.isrLoad.tonePerHz,
  },
  'loop-min-us': {
    reason: 'The simulator charges every loop() iteration LOOP_MIN_US (a policy); the board runs an empty one in 0.3125 µs. An interval may be longer on the simulator by that much per iteration that began in it.',
    refs: ['contract §4.2', 'contract §13 (Số vòng loop() mỗi giây)', 'EMU-08'],
    simUsPerIteration: unoContract.constants.LOOP_MIN_US,
  },
  'serial-time': {
    reason: 'The simulator does not charge Serial time yet (contract §7, note of C1 fix round 1); the board spends it. An interval may be longer on the board by the contract §7 model of the lines printed in it: each digit at most a whole number (serialPrintLongBase + serialPrintLongDigit), a minus sign serialPrintLongSign, any other byte serialQueueByte, serialPrintln per line, and the wait for room when the queue is full.',
    refs: ['contract §7', 'contract §4.4 (serial*)', 'contract §13 (USART)', 'EMU-08'],
    digitUs: costs.serialPrintLongBase + costs.serialPrintLongDigit,
    signUs: Math.max(costs.serialPrintLongSign, costs.serialQueueByte),
    byteUs: costs.serialQueueByte,
    lineUs: costs.serialPrintln,
  },
  'call-costs': {
    reason: 'The costs table is of calls the compiler did not fold (sketch costs); in a program\'s own -flto build the same calls take 8…41 % less (tone with constants 96 %), and the code between them (argument moves, a helper\'s clamps, call and return) is not in the table at all: an interval shorter than 1 ms may differ by that share either way. The simulator puts a pin change at the end of its call, the board inside it, so each side\'s event is a range.',
    refs: ['ADR 0003 §4', 'ADR 0003 §7.1', 'contract §4.4 (Độ lệch theo chương trình)', 'contract §13 (Chi phí lệnh ngắn)', 'EMU-09'],
    shortShare: 0.41,
  },
  'helper-compute': {
    reason: 'The simulator charges a driver helper\'s Arduino calls, not its own arithmetic. motorSet computes (|speed| · 255 + 50) / 100 in long (a libgcc 32-bit multiply and divide) before analogWrite: measured 58.875 µs for motorSet(50) and 63.75 µs for motorSet(-100) against the 16.8125 µs and 21 µs the simulator charges (sketch helper-costs).',
    refs: ['contract §6.1', 'contract §4.4 (Độ lệch theo chương trình)', 'contract §13 (Chi phí helper motorSet)', 'EMU-17'],
    motorSetUs: Math.max(58.875 - (2 * costs.digitalWrite + costs.analogWrite), 63.75 - (2 * costs.digitalWrite + costs.analogWriteDigital)),
  },
  'tone-call-cost': {
    reason: 'costsUs.tone (174.0625 µs) is tone() on a pin that already plays, at 1000 Hz. A tone on a silent pin also registers the pin and sets Timer2 up, and tone() tries Timer2\'s prescalers in turn (one long division each) until the compare value fits 8 bits, so it costs by the band of its frequency (sketch helper-costs, the shortest of 8 samples): from 145.625 µs at 4000 Hz to 308.8125 µs at 31 Hz.',
    refs: ['contract §4.4 (tone)', 'contract §6.3', 'contract §13 (Chi phí tone theo tần số)', 'EMU-17'],
    /** From the lowest frequency up: a band's prescaler holds every frequency from `fromHz` (where 16 MHz / (2 · p · hz) − 1 ≤ 255). */
    bands: [
      { prescaler: 1024, fromHz: 31_250 / 1024, us: 308.8125 },
      { prescaler: 256, fromHz: 31_250 / 256, us: 301.6875 },
      { prescaler: 128, fromHz: 31_250 / 128, us: 262.25 },
      { prescaler: 64, fromHz: 31_250 / 64, us: 224.375 },
      { prescaler: 32, fromHz: 31_250 / 32, us: 184.8125 },
      { prescaler: 8, fromHz: 31_250 / 8, us: 145.625 },
    ],
    replacingUs: 173.0625,
    simUs: costs.tone,
  },
  'waveform-phase': {
    reason: 'PWM, servo pulses and tones run on hardware timers: a change shows at the timer\'s next period, where the simulator states it at the call. The board decoder gives a waveform\'s start and stop as a range of one period.',
    refs: ['contract §5.1', 'contract §6.2', 'contract §6.3', 'EMU-02', 'EMU-03', 'EMU-05'],
  },
  'servo-first-pulse': {
    reason: 'Servo 1.3.0 sends the first pulse after attach() only once Timer1, cleared to 0 by attach() at /8, wraps to its first compare (65536 × 0.5 µs) and one 20 ms refresh has passed; the simulator has the servo at its angle from attach(). Later changes show within one frame (waveform-phase).',
    refs: ['contract §6.2', 'contract §13 (Xung servo đầu tiên)', 'EMU-16'],
    firstPulseAfterAttachUs: 65_536 * 0.5 + 20_000,
    slackUs: 100,
  },
  'tone-frequency': {
    reason: 'The board plays the frequency Timer2 can make from the asked one (440 → 440.141 Hz); the simulator plays the asked one.',
    refs: ['contract §6.3', 'EMU-13'],
    share: 0.01,
  },
  'tone-duration': {
    reason: 'The board plays floor(2 · hz · ms / 1000) half periods, the simulator ms exactly: a tone\'s end may come up to one period early on the board (a range of one period, waveform-phase).',
    refs: ['contract §6.3', 'contract §13 (Thời lượng tone)', 'EMU-13'],
  },
  'pulsein-short': {
    reason: 'pulseIn counts loop turns, so interrupt time during the echo is not counted: the board reads 0…1.10 % short (2…3 % while a tone plays), never long; the simulator reads the exact width. The fixtures\' echoes sit 50 µs into their centimetre (fixtures.ts echoOf), short enough that the shortfall stays inside it, so both read the same cm; the time of the read is not affected.',
    refs: ['contract §6.6', 'contract §13 (pulseIn đọc ngắn)', 'EMU-03', 'EMU-07'],
    shortShare: 0.011,
    toneShortShare: 0.03,
    usPerCm: unoContract.constants.ULTRASONIC_US_PER_CM,
  },
  'pulsein-no-echo': {
    reason: 'Without an echo the simulator charges pulseInNoPulse30000 (20 752 µs, measured without a Servo); with a Servo the board takes 20 785.44 µs, and an echo longer than the timeout 30 020.63 µs against the simulator\'s 30 000. Both fit the ±1 % of the interval.',
    refs: ['contract §13 (pulseIn không echo)', 'contract §13 (pulseIn có echo dài hơn timeout)', 'EMU-03'],
  },
} as const satisfies Record<string, AllowedDifference & Record<string, unknown>>;

export type AllowedDifferenceId = keyof typeof allowedDifferences;
