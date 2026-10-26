import { unoContract } from '../../src/core/compat/uno-contract';
import { unoR3Board } from '../../src/core/hardware';

// The differences the parity harness allows between the simulator (L1) and the HEX on avr8js (L2e), as data (N18 C2; ADR 0003
// §7 condition 2). Each entry says why the two sides differ and names the row of contract §13 (L1 ↔ L2e ↔ L3) that records it
// (tests/uno-emulator-parity.test.ts checks the row exists); its numbers come from the contract's data or are measured
// (spikes/avr8js/out/results.json, `node spikes/avr8js/run-helper-costs.mjs`, or this harness's own trace). The comparator
// (compare.ts) and the board decoder (board-trace.ts) apply them by id; no test body and no harness module has a tolerance of its
// own.
//
// The rule they extend (ADR 0003 §7 condition 1): events and Serial values, never cycles. A wait (delay(), pulseIn() with its
// echo, a tone's own length) takes the same time on both sides within ±1 %; the rest of an interval is Arduino calls, the
// simulator's node costs and loop() turns, Serial and interrupts, each bounded by its entry below.

const { costsUs: costs, isrLoad, millis, constants } = unoContract;

export type AllowedDifference = {
  /** Why the two sides differ. */
  readonly reason: string;
  /** The first cell of the contract §13 row that records the difference (backticks, bold and a trailing "(…)" left out). */
  readonly contractRow: string;
  /** Other places that record it: contract sections, ADR sections, evidence ids. */
  readonly refs: readonly string[];
};

/**
 * What a call does before the pinMode that makes an input pin an OUTPUT LOW, at most, in µs (allowed difference `output-low-first`):
 * the board's LOW against the start of the simulator's call, in the parity fixtures (EMU-16): 8.3125 µs for a computed buzzerTone in
 * driver-tone-computed (its clamps on long, then tone()'s toneBegin), 7.875 in sequenced-reads, 3.75 for a literal one (driver-buzzer,
 * driver-tone-led), 1 in the folded loops, 2.25 for Servo.attach (driver-servo), none for analogWrite (raw-pins).
 */
const BEFORE_PIN_MODE_US = 8.3125;

/** Servo 1.3.0 (contract §6.2, ARD-13): 544 µs at 0°, 2400 µs at 180°, a frame every 20 ms (REFRESH_INTERVAL). */
export const SERVO_PULSE = { minUs: 544, maxUs: 2400, frameUs: 20_000 } as const;

export const intervalRule = {
  reason: 'A wait (delay(), pulseIn() and its echo, a tone that plays for its ms) runs on the 16 MHz clock on both sides: the same within ±1 %, the rule of an interval of 1 ms or more, which waits dominate.',
  refs: ['ADR 0003 §7.1', 'contract §4.3', 'contract §4.4'],
  waitShare: 0.01,
  /** The report's "long" intervals, where ADR 0003 §7.1 promises ±1 %. */
  longFromUs: 1000,
} as const;

export const allowedDifferences = {
  'timer0-duty': {
    reason: 'avr8js gives Timer0 fast PWM (D5, D6) a HIGH time of v/256 of the period; the simulator models v/255 (the board, per datasheet, (v+1)/256). The board decoder reads a Timer0 duty on the 256 scale.',
    contractRow: 'Duty D5/D6',
    refs: ['ADR 0003 §6.1', 'contract §5.1', 'EMU-02', 'EMU-06'],
    timer: 'T0',
    scale: 256,
    otherScale: unoR3Board.pwmMax,
  },
  'usart-frame': {
    reason: 'avr8js sends one byte every 1044.17 µs (UDR and the shift register are one), the board 1040 µs. The harness times the TX line at the avr8js rate.',
    contractRow: 'USART',
    refs: ['ADR 0003 §6.2', 'contract §7', 'EMU-08'],
    frameUs: 1044.17,
    boardFrameUs: costs.serialLineByte,
  },
  'tx-queue': {
    reason: 'avr8js holds 64 bytes not yet sent before Serial.write blocks (the board, with its separate shift register, 65).',
    contractRow: 'USART',
    refs: ['ADR 0003 §6.2', 'contract §7', 'EMU-08'],
    bytes: constants.SERIAL_TX_QUEUE_BYTES,
  },
  'pull-up': {
    reason: 'avr8js models no pull-up: a floating INPUT_PULLUP pin reads LOW. The harness drives every input pin of the kit, a pull-up pin HIGH unless the fixture presses it (inputs.ts).',
    contractRow: 'Chân thả nổi / pull-up',
    refs: ['ADR 0003 §6.3', 'ADR 0003 §7.4', 'contract §6.4'],
    releasedLevel: 1,
  },
  'output-low-first': {
    reason: 'analogWrite(), Servo.attach() and the first tone() on a pin start with pinMode(pin, OUTPUT): on a pin that was an input the board shows LOW first, then the level or the waveform; the simulator goes straight to it. The simulator\'s trace gets that LOW at the start of the call (sim-run.ts), within what the call does before its pinMode, so the call itself is timed from it.',
    contractRow: 'Chân thành OUTPUT LOW trước',
    refs: ['contract §5.1', 'contract §6.2', 'contract §6.3', 'EMU-16'],
    beforePinModeUs: BEFORE_PIN_MODE_US,
  },
  'isr-load': {
    reason: 'The simulator charges no interrupt time; on the board the Timer0 overflow (millis), each Servo and a playing tone take cycles from the program\'s calls and statements (not from a delay(), which runs on micros()). An interval may be longer on the board by that load on its calls and statements, and by one run of each interrupt that is running.',
    contractRow: 'Tải ngắt',
    refs: ['contract §4.5', 'EMU-08'],
    timer0Share: isrLoad.timer0,
    servoShare: isrLoad.perServo,
    toneSharePerHz: isrLoad.tonePerHz,
    /** One Timer0 overflow interrupt: its share of the 1024 µs between two. */
    timer0IsrUs: isrLoad.timer0 * millis.overflowUs,
    /** One Servo's interrupts in a 20 ms frame. */
    servoFrameUs: isrLoad.perServo * SERVO_PULSE.frameUs,
    /** One tone toggle: the share of a hertz over the two toggles of a period. */
    toneIsrUs: (isrLoad.tonePerHz * 1e6) / 2,
  },
  'loop-min-us': {
    reason: 'The simulator charges every loop() iteration LOOP_MIN_US (a policy); the board runs an empty one in 0.3125 µs. An interval may be longer on the simulator by that much per iteration under way in it.',
    contractRow: 'Số vòng loop() mỗi giây',
    refs: ['contract §4.2', 'EMU-08'],
    simUsPerIteration: constants.LOOP_MIN_US,
  },
  'call-costs': {
    reason: 'The costs table is of calls the compiler did not fold (sketch costs); in a program\'s own -flto build a call may take 8…41 % less (folded with its constants: sketch costs-const), and no measurement shows one taking more (tone() aside: tone-fold). A node the simulator charges NODE_US (a policy) costs the board 0…NODE_US in the fixtures, which have no long division of the learner. So an interval may be shorter on the board by 41 % of the calls charged in it and by its node costs.',
    contractRow: 'Chi phí lệnh ngắn',
    refs: ['ADR 0003 §4', 'contract §4.2', 'contract §4.4 (Độ lệch theo chương trình)', 'EMU-09'],
    fasterShare: 0.41,
    nodeUs: constants.NODE_US,
  },
  'tone-fold': {
    reason: 'The simulator charges tone() by band the cost of the call -flto does not fold (toneUs, measured with the frequency computed at run time). The board\'s cost depends on the whole program: with few call sites -flto inlines buzzerTone and tone() and folds a literal frequency, and what is left of a folded tone() is 17.625…17.75 µs in every band (one call site, EMU-18); 2 or 3 sites fold part of it (99.75, 138.9375 µs at 1000 Hz); a literal frequency in a program of 5 call sites took at most 0.47 % more than the band. A frequency read at run time cannot be folded: one computed call took 213.375 µs (17.52 % more than its band), tone() inlined in sequenced-reads 9.3 % more, and inside a band the board may take up to 2.80 % less (3892…4000 Hz on a playing pin, 134.625 against 138.5 µs). The allowance is of the band\'s contract cost for the call (silent or playing pin), not of what the simulator charged: a simulator that overcharges a tone() is not covered.',
    contractRow: 'Chi phí tone theo chương trình',
    refs: ['contract §4.4 (toneUs)', 'contract §6.3', 'EMU-18', 'EMU-16'],
    literal: { floorUs: 17.625, slowerShare: 308 / 306.5625 - 1 },
    runtime: { fasterShare: (138.5 - 134.625) / 138.5, slowerShare: 213.375 / 181.5625 - 1 },
  },
  'serial-time': {
    reason: 'The simulator does not charge Serial time yet (contract §7, note of C1 fix round 1); the board spends it. The harness models it by contract §7: each digit at most a whole printed number (serialPrintLongBase + serialPrintLongDigit), a minus sign serialPrintLongSign, any other byte serialQueueByte, serialPrintln per line, Serial.begin once, and the wait for room when the TX queue is full. An interval may be longer on the board by that; a line leaves the USART when its print has queued it, or when the line before it has gone out.',
    contractRow: 'Thời gian Serial',
    refs: ['contract §7', 'contract §4.4 (serial*)', 'EMU-08', 'EMU-17'],
    digitUs: costs.serialPrintLongBase + costs.serialPrintLongDigit,
    signUs: Math.max(costs.serialPrintLongSign, costs.serialQueueByte),
    byteUs: costs.serialQueueByte,
    lineUs: costs.serialPrintln,
    /** Serial.begin(9600), measured in sketch helper-costs (EMU-17). */
    beginUs: 4.75,
  },
  'join-by-parts': {
    reason: 'The board prints a join part by part (one Serial.print per part, each evaluated in turn), so its first bytes may leave before the later parts are read; the simulator evaluates every part, then prints the line. A join\'s line may start on the board as early as its print statement starts.',
    contractRow: 'Join in từng phần',
    refs: ['contract §7 (Ghi chú cho ai nối mô hình hàng TX)', 'contract U-17'],
  },
  'waveform-phase': {
    reason: 'PWM, servo pulses and tones run on hardware timers: a change shows at the timer\'s next period, where the simulator states it at the call. The board decoder gives a waveform\'s start and stop as a range of one period.',
    contractRow: 'Pha của PWM, xung servo, tone',
    refs: ['contract §5.1', 'contract §6.2', 'contract §6.3', 'EMU-02', 'EMU-03', 'EMU-05'],
  },
  'waveform-jitter': {
    reason: 'avr8js applies a timer\'s compare output when the instruction under way ends (1…4 cycles): hardware PWM periods of 16 381…16 387 cycles and HIGH times within ±3 cycles (driver-motor, negate-drive, EMU-16), 0.375 µs at most, so 0.5 µs. Servo pulses and tone toggles are set by interrupts, which wait for any interrupt under way (Timer0\'s takes 6 µs): a servo period varies by 20 002.8…20 005.6 µs and its width by 1 µs (EMU-03). A run of periods of one waveform may vary by this much; fewer than two whole periods (three rising edges) show no period. N19 (G0.2 ruling c1): on the gripper car the TWI interrupt runs too (up to 20.125 µs: twi_stop() waits for the STOP inside it), and with Timer0\'s it held the Servo interrupt by up to 5.1875 µs (EMU-19): a servo pulse of a ref-uno-gripper@0 fixture may vary by 6 µs; the rover\'s keep 4.',
    contractRow: 'Rung xung servo, tone',
    refs: ['contract §6.2', 'contract §6.3', 'EMU-03', 'EMU-16'],
    minRunPeriods: 2,
    pwm: { periodUs: 0.5, highUs: 0.5 },
    servo: { frameShare: 0.01, periodMinUs: 8, highUs: 4, widthSlackUs: 4, gripperHighUs: 6 },
    tone: { share: 0.01, minUs: 8 },
  },
  'millis-origin': {
    reason: 'Both sides compute millis() by the board\'s model (n + floor(3n / 125), n = floor(t / 1024 µs)); the simulator counts t from the start of setup(), the board from Timer0\'s start, which init() sets 0…7.9 µs before setup() (EMU-12). A program that polls millis() goes on when it turns, so that moment is an anchor, known on the board within this offset.',
    contractRow: 'Gốc thời gian của millis()',
    refs: ['contract §4.3', 'EMU-12'],
    timer0BeforeSetupUs: 7.9,
  },
  'servo-first-pulse': {
    reason: 'Servo 1.3.0 sends the first pulse after attach() only once Timer1, cleared to 0 by attach() at /8, wraps to its first compare (65536 × 0.5 µs) and one 20 ms refresh has passed (N19: a second servo on Timer1, the gripper\'s lift, sends one pulse at that first wrap already, its next a frame and the first servo\'s pulse later: timerWrapUs) (measured 52 802 µs: 34 µs more, the interrupts and the library\'s own ticks); the simulator has the servo at its angle from attach(). Later changes show within one frame (waveform-phase). That first pulse is also a few µs longer than the steady pulses after it (measured 3.5625 µs on D9, 4.5625 µs on D10 in the N18 R8a kit-swap rehearsal): it joins the run of its angle when its width is within firstWidthUs of the next pulse\'s, the time of Timer0\'s interrupt (5.97 µs, isr-load) rounded up; every later pulse keeps waveform-jitter\'s 4 µs.',
    contractRow: 'Xung servo đầu tiên sau attach',
    refs: ['contract §6.2', 'EMU-16'],
    firstPulseAfterAttachUs: 65_536 * 0.5 + SERVO_PULSE.frameUs,
    slackUs: 100,
    firstWidthUs: 6,
    /**
     * N19 C2: the second servo of Timer1 (the gripper's lift after its claw). Servo 1.3.0's Channel[] starts at 0, not -1, so Timer1's
     * first wrap (65536 × 0.5 µs after attach) ends channel 0's pulse that never began and starts channel 1's: that servo pulses once at
     * 32.8 ms, then the frame starts over at 52.8 ms with channel 0, so its next pulse comes one frame and channel 0's pulse later (32 817
     * and 53 363 µs, a 544 µs claw before it, in driver-gripper). That first period is regular up to the widest pulse (maxUs) more.
     */
    timerWrapUs: 65_536 * 0.5,
  },
  'tone-frequency': {
    reason: 'The board plays the frequency Timer2 can make from the asked one (440 → 440.141 Hz); the simulator plays the asked one.',
    contractRow: 'Tần số tone',
    refs: ['contract §6.3', 'EMU-13'],
    share: 0.01,
  },
  'tone-duration': {
    reason: 'The board plays floor(2 · hz · ms / 1000) half periods, the simulator ms exactly: a tone\'s end may come up to one period early on the board (a range of one period, waveform-phase).',
    contractRow: 'Thời lượng tone',
    refs: ['contract §6.3', 'EMU-13'],
  },
  'pulsein-short': {
    reason: 'pulseIn counts loop turns, so interrupt time during the echo is not counted: the board reads 0…1.10 % short (2…3 % while a tone plays), never long; the simulator reads the exact width. The fixtures\' echoes sit 50 µs into their centimetre (fixtures.ts echoOf), short enough that the shortfall stays inside it, so both read the same cm; the time of the read is not affected.',
    contractRow: 'pulseIn đọc ngắn',
    refs: ['contract §6.6', 'EMU-03', 'EMU-07'],
    shortShare: 0.011,
    toneShortShare: 0.03,
    usPerCm: constants.ULTRASONIC_US_PER_CM,
  },
  'pulsein-no-echo': {
    reason: 'Without an echo the simulator charges pulseInNoPulse30000 (20 752 µs, measured without a Servo); with a Servo the board takes 20 785.44 µs, and an echo longer than the timeout 30 020.63 µs against the simulator\'s 30 000. Both are waits within ±1 %.',
    contractRow: 'pulseIn / siêu âm không echo',
    refs: ['contract §6.6', 'EMU-03'],
  },
} as const satisfies Record<string, AllowedDifference & Record<string, unknown>>;

export type AllowedDifferenceId = keyof typeof allowedDifferences;
