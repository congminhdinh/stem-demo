import type {
  Claim,
  ClaimKind,
  ClaimLevels,
  ConstructContract,
  CppLibrary,
  CppMapping,
  Domain,
  EvidenceEntry,
  EvidenceRef,
  FieldEntry,
  LedgerSupport,
  ModuleContract,
  NaReason,
  OfField,
  Pred,
  Profiles,
  UnoContract,
  UnoEvidenceKind,
} from './contract-types';

// The UNO compatibility contract v0 as data (N18 R0.3, docs/uno-compatibility-contract.md). The document is the
// source of truth: nothing here may say more than it does. Every number comes from the R0.4 avr8js spike
// (spikes/avr8js/out/results.json, docs/adr/0003-avr8js-parity.md) or from a quoted source of the ledger.
// Tests read this file; production code does not (the virtual UNO, drivers and generator copy the values they use).

// --- Evidence ledger (contract §14) -----------------------------------------------------------

const day = '2026-10-25';
const emulated = 'avr8js 0.21.1 on Node 24.22.1 (Apple M4 Pro); HEX built by arduino-cli 1.5.1 for arduino:avr:uno (arduino:avr@1.8.8, Servo 1.3.0); spikes/avr8js/out/results.json';
const compiled = 'arduino-cli 1.5.1 compile --fqbn arduino:avr:uno (arduino:avr@1.8.8, avr-gcc 7.3.0-atmel3.6.1-arduino7, Servo 1.3.0)';
const reference = (page: string) => `github.com/arduino/reference-en, Language/${page} (accessed ${day})`;
const draft = (section: string) => `eel.is/c++draft/${section} (accessed ${day})`;

const entry = (
  kind: UnoEvidenceKind,
  source: string,
  action: string,
  observed: string,
  supports: readonly LedgerSupport[],
  establishes: readonly OfField[] = [],
): EvidenceEntry => ({ kind, date: day, source, action, observed, supports, establishes });
const emu = (action: string, observed: string, establishes: readonly OfField[]) => entry('EMU', emulated, action, observed, ['emu-trace'], establishes);
const ard = (source: string, observed: string, establishes: readonly OfField[]) => entry('ARD', source, 'Read the page and quoted it', observed, ['documented'], establishes);
const cxx = (source: string, observed: string, establishes: readonly OfField[]) => entry('CXX', source, 'Read the section and quoted it', observed, ['documented', 'language'], establishes);

const evidence: Record<EvidenceRef, EvidenceEntry> = {
  'EMU-01': emu('sketches/blink: D13 HIGH 500 ms, LOW 500 ms', 'HIGH 500008.44 / 500012.19 / 500008.94 µs; LOW 500008.06 / 500010.94 / 500010.88 µs; pinMode(13, OUTPUT) takes D13 from INPUT to LOW at 11.25 µs', ['unit', 'block', 'default', 'content']),
  'EMU-02': emu('sketches/motor: motorSet on D5/D7/D8 and D6/D4/D2 with 50, -100, -30, 1, 0', 'D5 976.563 Hz HIGH 512 µs (128), 308 µs (77); D6 HIGH (255), 12 µs (3); IN pins as the sign says; 0: all LOW; the PWM goes on while the program waits', ['unit', 'round', 'yield', 'default', 'content']),
  'EMU-03': emu('sketches/servo-pulsein: Servo D9 and pulseIn on D11 against scripted echoes (450 µs after TRIG, widths 116..30500 µs, none)', 'servo 544 + a·1856/180 µs every 20002.8..20005.6 µs; pulseIn 0..1.10 % short; echo end to return 2.625..3.3125 µs; no echo 20785.44 µs; echo beyond the timeout 30020.63 µs; cm 19 / 10 / 400 / 397 / 2 / 49 / 400', ['unit', 'range', 'default', 'clamp', 'round', 'block', 'yield', 'return', 'content']),
  'EMU-04': emu('sketches/servo-pwm10: analogWrite(10, 200) alone, after Servo.attach(9), while attached, after detach', 'alone 490.196 Hz duty 200/255; attach stops it and holds D10 LOW; analogWrite(10) while attached: LOW, no PWM; after detach still LOW; servo pulses go on', ['yield', 'error', 'content']),
  'EMU-05': emu('sketches/tone-pwm11: analogWrite(11/3, 100) alone, tone(10, 1000), analogWrite while the tone plays, noTone, tone with 50 ms', 'alone 490.196 Hz; tone stops D3/D11 PWM (LOW); analogWrite(11) while the tone plays changes it to 2475.248 Hz; noTone, then a new analogWrite(11/3, 100), gives the PWM back; tone(10, 1000, 50) plays 49.36 ms and does not block', ['block', 'yield', 'error', 'content']),
  'EMU-06': emu('sketches/pwm-pins: analogWrite on D3 D5 D6 D9 D10 D11 at once, and on D7 D8 A0 A1', 'D5/D6 976.563 Hz, D3/D9/D10/D11 490.196 Hz, duty v/255 (avr8js gives v/256 on Timer0); 127 -> LOW, 128 -> HIGH, 200 -> HIGH, 0 -> LOW on pins without PWM', ['unit', 'range', 'yield', 'content']),
  'EMU-07': emu('sketches/kit-rover: every module of ref-uno-rover@0 at once', 'servo 1007..1008 µs, tone 1000 Hz, D5 duty 128, D6 duty 204, IN levels, LED, button 1/0/1, analogRead 0/512/1023 for 0/2.5/5 V; echo 1160 µs read as 1125..1134 µs while the tone plays', ['range', 'yield', 'return', 'content']),
  'EMU-08': emu('sketches/costs: each Arduino call between port-write markers, 8 samples, shortest minus the baseline', 'digitalWrite 73 cycles, digitalRead 63, analogRead 1693 (first 3229), analogWrite 123, millis 19, Servo.write 792, tone 2785, Serial byte queued 6.28 µs, beyond 64 bytes 1044.17 µs each (avr8js), empty loop() 5 cycles; Timer0 interrupt 0.583 %, one Servo 0.163 %, tone 1000 Hz 1.49 %', ['block']),
  'EMU-09': emu('sketches/costs-const: the same calls with constant arguments in a small program', 'digitalWrite 58 cycles, analogWrite 73, Servo.write 726, tone(10, 1000) 94: -flto inlines or folds per program', ['block']),
  'EMU-10': emu('sketches/lang: the int32 rules with volatile inputs', '300 * 200 = -5536, 300L * 200L = 60000; plain x + 1 > x (x = INT32_MAX) = 1 and (h * 2) / 2 = h: folded; -7/2 = -3, -7%2 = -1, 7%-2 = 1; INT32_MIN / -1 = INT32_MIN; x % -1 = 0; println(true) 1, println(false) 0; -1 < millis() is 0, -1 < (long)millis() is 1', ['range', 'round', 'return', 'error', 'content']),
  'EMU-11': emu('sketches/lang-wrap and lang-wrapv: plain operators, unsigned helpers, __builtin_*_overflow, an asm barrier, noinline, #pragma GCC optimize("wrapv")', 'every helper wraps correctly when no plain signed overflow runs in the program; after one, unsigned and builtin helpers are merged with it (CSE); the pragma makes plain operators wrap', ['round', 'return', 'error']),
  'EMU-12': emu('sketches/millis-drift: 250 reads of millis() about 4 ms apart against the cycle counter', 'millis = n + floor(3n / 125), n = floor((t - t0) / 1024 µs): 250 of 250 for every t0 0..7.9 µs before setup()', ['unit', 'range', 'round', 'return']),
  'EMU-13': emu('sketches/contract-forms: every C++ form and helper of this contract, with scripted echo, line, button and ADC', '29 of 29 checks: int32 helpers, bool 1/0, repeat and count up order, if / else if / else and while, UTF-8 and escaped text, (long)millis() on the model, motorSet and drive forms, servoSet clamps, buzzerTone clamps and re-tone, noTone, ultrasonicCm 19 cm (call 1675.5625 µs) and 400 (call 20812 µs; 1675.375 and 20806.3125 in the build without the if/while section), line, button, raw pins', ['unit', 'range', 'default', 'clamp', 'round', 'block', 'yield', 'return', 'error', 'content']),
  'EMU-14': entry(
    'EMU',
    'avr8js 0.21.1 on Node 24.22.1 (Apple M4 Pro); HEX built by arduino-cli 1.5.1 for arduino:avr:uno (arduino:avr@1.8.8); node spikes/avr8js/run-tone-notone.mjs (N18 R1, not in results.json)',
    'sketches/tone-notone: analogWrite(11/3, 100), tone(10, 1000), noTone with no new analogWrite, analogWrite again, tone(10, 1000, 30) that ends by itself, analogWrite again',
    'alone 490.196 Hz duty 0.39216; tone: D3/D11 LOW; after noTone with no new analogWrite: D3/D11 LOW; a new analogWrite: 490.196 Hz again; after the 30 ms tone ended by itself: D3/D11 LOW; a new analogWrite: 490.196 Hz again',
    ['emu-trace'],
    ['content'],
  ),
  'EMU-15': entry(
    'EMU',
    'avr8js 0.21.1 on Node 24.22.1 (Apple M4 Pro); HEX built by arduino-cli 1.5.1 for arduino:avr:uno (arduino:avr@1.8.8); node spikes/avr8js/run-eval-order.mjs (N18 C1, not in results.json)',
    'sketches/eval-order: se(v) and sb(v) print their value when they are evaluated, in the plain forms and in the sequenced form of §3.5',
    'plain: add32(se(1L), se(2L)) eval=2, eval=1; sub32(se(3L), se(4L)) 4, 3; f3(10, se(7L), se(8L)) 8, 7; add32(mul32(se(9L), se(10L)), se(11L)) 11, 10, 9; (se(5L) < se(6L)) 5, 6. Sequenced: (_s1 = se(1L), _s2 = se(2L), add32(_s1, _s2)) eval=1, eval=2; sub32 3, 4; (_s1 = se(7L), _s2 = se(8L), f3(10, _s1, _s2)) 7, 8; three temporaries 9, 10, 11; while ((_s1 = se(x), _s2 = se(2L), (_s1 < _s2))) evaluates both each time (0, 2, 1, 2, 2, 2); (sb(false) && sb(true)) and (sb(true) || sb(false)) evaluate the left side only; (_s4 = (sb(true) && sb(false)), _s5 = sb(true), (_s4 == _s5)) 1, 0, 1, then prints 0',
    ['emu-trace'],
    ['content'],
  ),
  'EMU-16': entry(
    'EMU',
    'avr8js 0.21.1 on Node 24.22.1 (Apple M4 Pro); HEX built by scripts/build-parity-hex.mjs with arduino-cli 1.5.1 for arduino:avr:uno (arduino:avr@1.8.8, Servo 1.3.0), tests/__parity__; pnpm test tests/uno-emulator-parity.test.ts (N18 C2)',
    'C2 parity: the generated sketch of every C1 language golden, of the raw-pins golden, of one program per driver op of ref-uno-rover@0, of two with an LED right after tone() and of negate-drive (25 fixtures), its HEX on avr8js against the simulator with the same scripted inputs; pin events and Serial lines compared, each timed from the anchor it depends on',
    '25 of 25 agree: every Serial line and pin state (duty, angle, tone ±1 %); every interval within its waits ±1 % and the allowed differences (largest with no line printed in it 0.276 %, driver-buzzer; lines queued behind the one before ≤ 0.58 µs; an LED right after a computed tone() ≤ 4.38 µs, after a literal one, folded, up to 87.25 µs early); Servo 1.3.0 sends its first pulse 52802 µs after attach(); a PWM, servo or tone change shows within one timer period; tone() inlined in sequenced-reads took ≥ 240.1 µs (224.375 alone)',
    ['emu-trace'],
    ['block', 'yield', 'return', 'content'],
  ),
  'EMU-17': entry(
    'EMU',
    'avr8js 0.21.1 on Node 24.22.1 (Apple M4 Pro); HEX built by arduino-cli 1.5.1 for arduino:avr:uno (arduino:avr@1.8.8); node spikes/avr8js/run-helper-costs.mjs (N18 C2, not in results.json)',
    'sketches/helper-costs: motorSet with run-time speeds -100..100 against its Arduino calls; tone(10, f, 100) at 31..4000 Hz on a silent pin and on a pin playing 1000 Hz; Serial.begin(9600)',
    'motorSet(50) 58.875 µs, motorSet(-100) 63.75 µs (42.0625 / 42.75 µs beyond 2 digitalWrite + analogWrite as the simulator charges them); at speeds 1, 30, 60, 70, 99: 59.0625, 59.4375, 59.4375, 59.625, 59.8125 µs; -1, -30, -70: 59.5625, 59.9375, 60.125 µs (43.3125 beyond the calls, the longest); 0 and 100: 61.25, 63.25 µs; tone on a silent pin 308.8125 µs at 31 Hz, 307.125 at 100, 301.6875 at 200, 262.25 at 440, 224.375 at 500, 184.8125 at 1000, 184.625 at 1500, 184.4375 at 3000, 145.625 at 4000; on a playing pin 297.25, 295.5625, 290.125, 250.6875, 212.8125, 173.25, 173.0625, 172.875, 134.0625; Serial.begin(9600) 4.75 µs',
    ['emu-trace'],
    ['block'],
  ),
  'EMU-18': entry(
    'EMU',
    'avr8js 0.21.1 on Node 24.22.1 (Apple M4 Pro); HEX built by arduino-cli 1.5.1 for arduino:avr:uno (arduino:avr@1.8.8) from sketches the generator writes; node spikes/avr8js/run-generated-tone.mjs (N18 C2 fix round 2, not in results.json)',
    'generated sketches: LED on; buzzerTone(BUZZER_PIN, <hz>, 20L); LED off, minus LED on; LED off, at 25 frequencies (the edges and inside of each Timer2 band), the frequency a literal or computed from two analogRead, on a silent pin and on a playing one, 75 call sites a program; and the same at 1000 Hz in programs of 1, 2, 3 and 5 call sites',
    'computed, silent pin, longest per band: 306.5625 µs (31..121 Hz), 298.1875 (122..243), 258.9375 (244..486), 219.6875 (487..972), 181.5625 (973..3891), 143.3125 (3892..4000); playing pin 300.5625, 293.4375, 254, 214.625, 176.5625, 138.5; up to 5.3125 µs shorter inside a band; a literal frequency 3 µs shorter with 75 call sites; at 1000 Hz with 1, 2, 3, 5 call sites: literal 17.6875, 99.75, 138.9375, 178.5625 µs (folded), computed 213.375, 187.9375, 187.9375, 181.5625',
    ['emu-trace'],
    ['block'],
  ),
  'CC-01': entry('CC', compiled, 'Compiled the 15 spike sketches (ram-threshold 8 times)', 'All compile (ram-threshold refuses its 2049 B probe by design, CC-02); e.g. kit-rover 4752 B flash (14 %), 247 B RAM (12 %); 300 * 200 warns -Woverflow', ['compile-ok', 'compile-size', 'snapshot'], ['call', 'import', 'module']),
  'CC-02': entry('CC', compiled, 'sketches/ram-threshold with -DBIG=1000..2040', '1536 B of globals (75.000 %): no warning; 1537 B (75.049 %) and above: "Low memory available, stability problems may occur."; 2049 B: "Not enough memory", the build fails; flash maximum 32256 B', ['compile-size']),
  'CC-03': entry('CC', compiled, 'Compiled sketches/contract-forms with --warnings all', 'Compiles; no warning from the sketch (only from the core); 7474 B flash (23 %), 258 B RAM (12 %)', ['compile-ok', 'compile-size'], ['call', 'import', 'module']),
  'CC-04': entry('CC', `${compiled}; avr-objdump -d of servo-pulsein.ino.elf`, 'Read countPulseASM', 'Wait-for-start loop 11 cycles, counting loop 16 cycles, one budget of `timeout` iterations; pulseIn returns (count · 16 + 16) / 16 µs', ['disassembly'], ['block']),
  'CC-05': entry('CC', compiled, 'Compiled sketches/eval-order with --warnings all', 'Compiles; no warning from the sketch (only from the core); 3118 B flash (9 %), 192 B RAM (9 %); long and bool temporaries at the top of setup(), the comma form in an assignment, a print, a while condition and a call statement', ['compile-ok', 'compile-size'], ['call']),
  'PKG-01': entry('PKG', 'gh api repos/arduino/ArduinoCore-avr/releases, repos/arduino-libraries/Servo/releases, repos/wokwi/avr8js/releases; arduino-cli version', 'Read the release dates', 'arduino:avr 1.8.8 2026-05-21; Servo 1.3.0 2025-11-06; avr8js v0.21.1 2026-08-31; arduino-cli 1.5.1 2026-06-05', ['snapshot']),
  'ARD-01': ard(reference('Functions/Analog IO/analogWrite.adoc'), '"UNO (R3 and earlier), Nano, Mini | 3, 5, 6, 9, 10, 11 | 490 Hz (pins 5 and 6: 980 Hz)"; "`value`: the duty cycle: between 0 (always off) and 255 (always on)"; "…until the next call to `analogWrite()` (or a call to `digitalRead()` or `digitalWrite()`) on the same pin"; "The PWM outputs generated on pins 5 and 6 will have higher-than-expected duty cycles"', ['unit', 'range', 'content']),
  'ARD-02': ard(reference('Functions/Analog IO/analogRead.adoc'), '"…into integer values between 0 and 1023"; "it takes about 100 microseconds (0.0001 s) to read an analog input"', ['range', 'block', 'return']),
  'ARD-03': ard(reference('Functions/Advanced IO/tone.adoc'), '"Only one tone can be generated at a time. … If the tone is playing on the same pin, the call will set its frequency."; "Use of the `tone()` function will interfere with PWM output on pins 3 and 11"; "It is not possible to generate tones lower than 31Hz."; "`duration`: the duration of the tone in milliseconds"; "This function is non-blocking"', ['unit', 'range', 'block', 'error', 'content']),
  'ARD-04': ard(reference('Functions/Advanced IO/pulseIn.adoc'), '"Returns the length of the pulse in microseconds or gives up and returns 0 if no complete pulse was received within the timeout."; "`timeout` (optional): the number of microseconds to wait for the pulse to start"', ['unit', 'return']),
  'ARD-05': ard(reference('Functions/Time/millis.adoc'), '"Number of milliseconds passed since the program started. Data type: `unsigned long`."; "This number will overflow (go back to zero), after approximately 50 days."', ['unit', 'range', 'return']),
  'ARD-06': ard(reference('Functions/Digital IO/digitalRead.adoc'), '"If the pin isn\'t connected to anything, `digitalRead()` can return either `HIGH` or `LOW` (and this can change randomly)."', ['range']),
  'ARD-07': ard(reference('Functions/Communication/Serial.adoc'), '"On older boards (Uno, Nano, Mini, and Mega), pins 0 and 1 are used for communication with the computer. Connecting anything to these pins can interfere with that communication"', ['range']),
  'ARD-08': ard(reference('Functions/Communication/Serial/write.adoc'), '"Serial transmission is asynchronous. If there is enough empty space in the transmit buffer, `Serial.write()` will return before any characters are transmitted over serial. If the transmit buffer is full then `Serial.write()` will block until there is enough space in the buffer."', ['block']),
  'ARD-09': ard(reference('Variables/Data Types/long.adoc'), '"…store 32 bits (4 bytes), from -2,147,483,648 to 2,147,483,647."; "…either an integer constant followed by an L or a variable of type long, forcing it to be a long."', ['range']),
  'ARD-10': ard(reference('Variables/Data Types/int.adoc'), '"an int stores a 16-bit (2-byte) value"; "The result of an overflow is unpredictable so this should be avoided."', ['range', 'error']),
  'ARD-11': ard(`${reference('Structure/Sketch/setup.adoc')}; ${reference('Structure/Sketch/loop.adoc')}`, '"The `setup()` function will only run once, after each powerup or reset of the Arduino board."; "the `loop()` function does precisely what its name suggests, and loops consecutively"', ['block', 'content']),
  'ARD-12': ard('Servo 1.3.0 docs/readme.md (installed library; github.com/arduino-libraries/Servo)', '"On boards other than the Mega, use of the library disables `analogWrite()` (PWM) functionality on pins 9 and 10, whether or not there is a Servo on those pins."', ['error', 'content']),
  'ARD-13': ard('Servo 1.3.0 docs/api.md (installed library)', '"_min_ (optional): the pulse width, in microseconds, corresponding to the minimum (0 degree) angle on the servo (defaults to 544)"; "…maximum (180 degree) angle on the servo (defaults to 2400)"; "_angle_: the value to write to the servo, from 0 to 180"', ['unit', 'range']),
  'ARD-14': ard(reference('Functions/Communication/Serial/print.adoc'), '"Numbers are printed using an ASCII character for each digit."; "You can pass flash-memory based strings to `_Serial_.print()` by wrapping them with F()."', ['content']),
  'ARD-15': ard(reference('Structure/Arithmetic Operators/remainder.adoc'), '"If the *first* operand is negative, the result is negative (or zero)."', ['round']),
  'ARD-16': ard(reference('Functions/Digital IO/pinMode.adoc'), '"It is possible to enable the internal pullup resistors with the mode `INPUT_PULLUP`."', ['default']),
  'ARD-17': ard(reference('Functions/Time/delay.adoc'), '"Pauses the program for the amount of time (in milliseconds) specified as parameter."', ['unit', 'block']),
  'DS-01': entry('DS', `Microchip DS40002061A, ATmega48A/PA/88A/PA/168A/PA/328/P datasheet (PDF downloaded ${day})`, 'Read and quoted', '"The port pins are tri-stated when reset condition becomes active, even if no clocks are running."; "If the OCR0A is set equal to BOTTOM, the output will be a narrow spike for each MAX+1 timer clock cycle."; "A normal conversion takes 13 ADC clock cycles. The first conversion after the ADC is switched on … takes 25 ADC clock cycles"; "For single ended conversion, the result is ADC = VIN · 1024 / VREF"', ['documented'], ['default', 'round', 'block']),
  'CXX-01': cxx(draft('expr.mul'), '"If the second operand of / or % is zero, the behavior is undefined. For integral operands, the / operator yields the algebraic quotient with any fractional part discarded; if the quotient a/b is representable in the type of the result, (a/b)*b + a%b is equal to a; otherwise, the behavior of both a/b and a%b is undefined."', ['round', 'return', 'error']),
  'CXX-02': cxx(draft('basic.fundamental'), '"…arithmetic for the unsigned type is performed modulo 2N. Unsigned arithmetic does not overflow."', ['return', 'error']),
  'CXX-03': cxx(`GCC 7.3 manual, "Integers implementation" (gcc.gnu.org/onlinedocs/gcc-7.3.0, accessed ${day}); ${draft('conv.integral')}`, '"For conversion to a type of width N, the value is reduced modulo 2^N to be within range of the type; no signal is raised."; "If the source type is bool, the value false is converted to zero and the value true is converted to one."', ['range', 'return', 'content']),
  'CXX-04': cxx(draft('lex.icon'), '"The type of an integer-literal is the first type in the list in Table 8 corresponding to its optional integer-suffix in which its value can be represented."', ['range']),
  'CXX-05': cxx(`${draft('expr.rel')}; ${draft('expr.eq')}; ${draft('expr.log.and')}; ${draft('expr.log.or')}; ${draft('expr.unary.op')}`, 'relational: "The type of the result is bool."; equality: "…a result of type bool"; &&: "the second operand is not evaluated if the first operand is false"; ||: "the second operand is not evaluated if the first operand evaluates to true"; !: "The type of the result is bool."', ['return']),
  'CXX-06': cxx(draft('conv.prom'), '"A prvalue of type bool can be converted to a prvalue of type int, with false becoming zero and true becoming one."', ['return', 'content']),
  'CXX-07': cxx(`${draft('stmt.for')}; ${draft('intro.execution')}`, 'for: "…is equivalent to { init-statement while ( condition ) { statement expression ; } }"; "Every value computation and side effect associated with a full-expression is sequenced before every value computation and side effect associated with the next full-expression to be evaluated."', ['range', 'content']),
  'CXX-08': entry('CXX', `GCC 7.3 manual, "Common Function Attributes" (optimize) and "Code Gen Options" (-fwrapv) (accessed ${day})`, 'Read and quoted', '"This attribute should be used for debugging purposes only. It is not suitable in production code."; -fstrict-overflow: "…overflow when doing arithmetic with signed numbers is undefined"', ['context']),
  'CXX-09': cxx(draft('expr.comma'), '"A pair of expressions separated by a comma is evaluated left-to-right; the left expression is a discarded-value expression. The left expression is sequenced before the right expression ([intro.execution]). The type and value of the result are the type and value of the right operand"', ['content']),
  'CXX-10': cxx(
    `${draft('expr.call')}; ${draft('intro.execution')}`,
    'call: "The initialization of a parameter … including every associated value computation and side effect, is indeterminately sequenced with respect to that of any other parameter."; "Except where noted, evaluations of operands of individual operators and of subexpressions of individual expressions are unsequenced."',
    ['content'],
  ),
};

// --- Builders ------------------------------------------------------------------------------

const claim = (kind: ClaimKind, sources: EvidenceRef | readonly EvidenceRef[], statement: string): Claim => ({
  kind,
  statement,
  sources: typeof sources === 'string' ? [sources] : sources,
});
const compiles = (statement: string) => claim('compile-ok', 'CC-03', statement);
const trace = (sources: EvidenceRef | readonly EvidenceRef[], statement: string) => claim('emu-trace', sources, statement);
const doc = (sources: EvidenceRef | readonly EvidenceRef[], statement: string) => claim('documented', sources, statement);
const language = (sources: EvidenceRef | readonly EvidenceRef[], statement: string) => claim('language', sources, statement);

/** VERIFIED when a source is the emulator or the compiler; otherwise DOCUMENTED. */
const field = (claims: readonly Claim[], corroboratedBy?: readonly EvidenceRef[]): FieldEntry => ({
  label: claims.some((c) => c.sources.some((id) => ['EMU', 'CC'].includes(evidence[id]?.kind ?? ''))) ? 'VERIFIED' : 'DOCUMENTED',
  claims,
  ...(corroboratedBy ? { corroboratedBy } : {}),
});
const na = (note: string, reason: NaReason = 'not-applicable'): FieldEntry => ({ label: 'n/a', reason, note });
const byDomain = (note: string) => na(note, 'domain-restricted');
const explicit = (note: string) => na(note, 'explicit-parameter');
const unknown = (note: string): FieldEntry => ({ label: 'UNKNOWN', note });

const irrelevant = 'Not relevant to this row.';
const open = (partial: Partial<Record<OfField, FieldEntry>>): Record<OfField, FieldEntry> => ({
  call: na(irrelevant), import: na('Arduino.h is included by the .ino build; nothing to include.'), module: na(irrelevant), unit: na(irrelevant),
  range: na(irrelevant), default: na(irrelevant), clamp: na(irrelevant), round: na(irrelevant), block: na(irrelevant),
  yield: na('Nothing runs in the background for this row.'), return: na(irrelevant), error: na(irrelevant),
  coord: na('No coordinates on the UNO.'), event: na('Interrupts and events are DEFERRED (U-43).'), content: na(irrelevant),
  ...partial,
});
const notOffered = 'Not established: the row is not offered.';
const closed = (partial: Partial<Record<OfField, FieldEntry>>): Record<OfField, FieldEntry> => ({
  ...Object.fromEntries((['call', 'import', 'module', 'unit', 'range', 'default', 'clamp', 'round', 'block', 'yield', 'return', 'error', 'coord', 'event', 'content'] as const).map((f) => [f, unknown(notOffered)])),
  ...partial,
} as Record<OfField, FieldEntry>);

const BOTH: Profiles = ['uno-basic', 'uno-advanced'];
const ADVANCED: Profiles = ['uno-advanced'];
const tierBoth = { 'uno-basic': 'MUST', 'uno-advanced': 'MUST' } as const;
const tierAdvanced = { 'uno-advanced': 'MUST' } as const;

const levels = (l1By: string, l2e: readonly EvidenceRef[]): ClaimLevels => ({
  L1: { status: 'PENDING', by: l1By },
  L2: { status: 'PASS', evidence: ['CC-03'] },
  L2e: { status: 'PASS', evidence: l2e },
  L3: { status: 'PENDING', by: 'M06' },
});
const notOfferedLevels: ClaimLevels = {
  L1: { status: 'n/a', note: 'Not offered.' },
  L2: { status: 'n/a', note: 'Not offered.' },
  L2e: { status: 'n/a', note: 'Not offered.' },
  L3: { status: 'n/a', note: 'Not offered.' },
};

const arg = (name: string) => ({ arg: name });
const num = (value: number) => ({ const: value });
const between = (name: string, low: number, high: number): Pred => ({ all: [{ le: [num(low), arg(name)] }, { le: [arg(name), num(high)] }] });
const domain = (args: Domain['args'], rule: Pred): Domain => ({ args, compileTime: [{ when: rule, diagnostic: 'value-out-of-range' }], runtime: rule });
const structural = (args: Domain['args']): Domain => ({ args, compileTime: [], runtime: { all: [] } });

const core: CppLibrary = { name: 'arduino:avr', version: '1.8.8', license: 'LGPL-2.1' };
const servoLibrary: CppLibrary = { name: 'Servo', version: '1.3.0', license: 'LGPL-2.1' };
const cpp = (form: string, extra: Partial<CppMapping> = {}): CppMapping => ({ form, includes: [], libraries: [core], ...extra });

// --- Helpers the generator writes verbatim (contract §3.2, §6). Same text as spikes/avr8js/sketches/contract-forms. --

const helpers = {
  int32: {
    text: [
      'long add32(long a, long b) { return (long)((unsigned long)a + (unsigned long)b); }',
      'long sub32(long a, long b) { return (long)((unsigned long)a - (unsigned long)b); }',
      'long mul32(long a, long b) { return (long)((unsigned long)a * (unsigned long)b); }',
      'long neg32(long a) { return (long)(0UL - (unsigned long)a); }',
      'long div32(long a, long b) { return b == -1L ? neg32(a) : (b == 0L ? 0L : a / b); }',
      'long mod32(long a, long b) { return (b == -1L || b == 0L) ? 0L : a % b; }',
    ].join('\n'),
    usedBy: ['U-05', 'U-06', 'U-07', 'U-08', 'U-21'],
  },
  'hbridge-en-in1-in2': {
    text: [
      'void motorSet(uint8_t en, uint8_t in1, uint8_t in2, long speed) {',
      '  if (speed > 100L) speed = 100L;',
      '  if (speed < -100L) speed = -100L;',
      '  long magnitude = speed < 0L ? -speed : speed;',
      '  digitalWrite(in1, speed > 0L ? HIGH : LOW);',
      '  digitalWrite(in2, speed < 0L ? HIGH : LOW);',
      '  analogWrite(en, (int)((magnitude * 255L + 50L) / 100L));',
      '}',
    ].join('\n'),
    usedBy: ['U-20', 'U-21', 'U-22'],
  },
  'servo-lib': {
    text: ['void servoSet(Servo &servo, long angle) {', '  if (angle < 0L) angle = 0L;', '  if (angle > 180L) angle = 180L;', '  servo.write((int)angle);', '}'].join('\n'),
    usedBy: ['U-23'],
  },
  'buzzer-tone': {
    text: [
      'void buzzerTone(uint8_t pin, long hz, long ms) {',
      '  if (hz < 31L) hz = 31L;',
      '  if (hz > 4000L) hz = 4000L;',
      '  if (ms < 1L) ms = 1L;',
      '  if (ms > 60000L) ms = 60000L;',
      '  tone(pin, (unsigned int)hz, (unsigned long)ms);',
      '}',
    ].join('\n'),
    usedBy: ['U-25'],
  },
  'hcsr04-pulsein': {
    text: [
      'long ultrasonicCm(uint8_t trig, uint8_t echo) {',
      '  digitalWrite(trig, LOW);',
      '  delayMicroseconds(2);',
      '  digitalWrite(trig, HIGH);',
      '  delayMicroseconds(10);',
      '  digitalWrite(trig, LOW);',
      '  long us = (long)pulseIn(echo, HIGH, 30000UL);',
      '  if (us == 0L) return 400L;',
      '  long cm = us / 58L;',
      '  if (cm < 2L) return 2L;',
      '  if (cm > 400L) return 400L;',
      '  return cm;',
      '}',
    ].join('\n'),
    usedBy: ['U-27'],
  },
  'pwm-write': {
    text: ['void pwmWrite(uint8_t pin, long value) {', '  if (value < 0L) value = 0L;', '  if (value > 255L) value = 255L;', '  analogWrite(pin, (int)value);', '}'].join('\n'),
    usedBy: ['U-32'],
  },
} as const;

// --- Modules (contract §2.2) -------------------------------------------------------------------

const modules: readonly ModuleContract[] = [
  {
    id: 'U-M1',
    module: 'arduino-core',
    importForm: null,
    library: core,
    fields: {
      import: na('The .ino build includes Arduino.h before the sketch; the generator writes no include for the core.'),
      module: field([compiles('Every form of this contract compiles against arduino:avr@1.8.8 for arduino:avr:uno.')], ['CC-01']),
    },
    eligibility: 'ELIGIBLE',
  },
  {
    id: 'U-M2',
    module: 'servo',
    importForm: '#include <Servo.h>',
    library: servoLibrary,
    fields: {
      import: field([compiles('#include <Servo.h> compiles with Servo 1.3.0 installed.')]),
      module: field([compiles('Servo 1.3.0 (LGPL-2.1) links for arduino:avr:uno: the Servo class, attach and write.')], ['CC-01']),
    },
    eligibility: 'ELIGIBLE',
  },
];

// --- Recurrent claims ---------------------------------------------------------------------------

const costs = (what: string) => trace('EMU-08', `${what} (contract §4.4); the simulator charges the costsUs of each Arduino call it makes.`);
const backgroundPwm = trace(['EMU-02', 'EMU-06'], 'The PWM is made by the timer hardware: it goes on while the program runs or waits.');

// --- Operand order (contract §3.5, 0.1.3, N18 C1) ------------------------------------------------

const sequencing =
  'Operands are evaluated left to right, each once, as in the simulator. C++ leaves the arguments of a call and the operands of a comparison unsequenced, and avr-gcc 7.3 evaluates call arguments right to left (EMU-15). When two or more operands of one such expression read the robot (a module read, millis, a raw pin read, or an && / || that reads), the generator assigns each, in the simulator\'s depth-first order, to a temporary _s<k> declared at the top of setup() or loop() (after the setup lines), with the comma operator, which is sequenced left to right: (_s1 = <read>, _s2 = <read>, <expr>). && and || stay native: they are sequenced and skip their right side as the simulator does (U-10).';
const sequencedForms = ['(_s<k> = <read>, … <expr>)', 'long _s<k>;', 'bool _s<k>;'];
const sequencedCall = (statement: string) =>
  claim('compile-ok', 'CC-05', `${statement} The sequenced form compiles with no warning: function-scope long / bool temporaries, the comma operator in an assignment, a print, a while condition and a call.`);
const sequencedContent = (what: string) =>
  field(
    [
      language('CXX-10', `${what} are unsequenced in C++ (a call's parameters are indeterminately sequenced): their order is not the language's.`),
      language('CXX-09', 'The comma operator evaluates left to right, each assignment to a temporary before the next: the reads happen in the simulator\'s order, once each.'),
    ],
    ['EMU-15'],
  );

// --- Rows that may be shown (contract §10.1) ----------------------------------------------------

const exposedRows: readonly ConstructContract[] = [
  {
    id: 'U-01',
    capability: 'program start: setup()',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['The on-start body is written inside void setup(), after the setup lines the rows need (Serial.begin, pinMode, attach).'],
    modules: ['U-M1'],
    cpp: cpp('void setup() {\n  <setup lines>\n  <body>\n}'),
    levels: levels('R2.3', ['EMU-13']),
    fields: open({
      call: field([compiles('void setup() { … } holds the start body.')]),
      block: field([doc('ARD-11', 'setup() runs once, after each power-up or reset.')], ['EMU-13']),
    }),
  },
  {
    id: 'U-02',
    capability: 'forever: loop()',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: [
      'There is no hidden delay: the board runs an empty loop() in 5 cycles (0.3125 µs).',
      'Without a forever block the generator writes an empty loop(): the board stays powered and keeps its outputs (PWM, servo pulses).',
      'The simulator charges LOOP_MIN_US = 50 µs per iteration (a policy, not the board): how many iterations run per second is not a parity observable.',
    ],
    modules: ['U-M1'],
    cpp: cpp('void loop() {\n  <body>\n}'),
    levels: levels('R2.3', ['EMU-08', 'EMU-13']),
    fields: open({
      call: field([compiles('void loop() { <body> }; without forever, void loop() {}.')]),
      block: field([doc('ARD-11', 'loop() loops consecutively.')], ['EMU-08']),
      content: field([doc('ARD-11', 'The core calls loop() consecutively; an empty loop() does nothing, so the outputs stay as setup() left them.')], ['EMU-02', 'EMU-06']),
    }),
  },
  {
    id: 'U-03',
    capability: 'variable (long, int32)',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['Every learner variable is a long at file scope, set to 0L. A comparison stored in it is 1 or 0.'],
    modules: ['U-M1'],
    cpp: cpp('long <name> = 0L; · <name> = <expr>;'),
    levels: levels('R2.3', ['EMU-10', 'EMU-13']),
    fields: open({
      call: field([compiles('long <name> = 0L; at file scope; <name> = <expr>; in a body.')]),
      range: field([doc('ARD-09', 'A long stores 32 bits, from -2,147,483,648 to 2,147,483,647.')], ['EMU-10']),
      default: explicit('The generator always writes = 0L.'),
      return: field([language('CXX-06', 'A bool stored in a long is 1 (true) or 0 (false).')], ['EMU-13']),
    }),
  },
  {
    id: 'U-04',
    capability: 'integer literal',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: [
      'Every literal is written with the L suffix (300L), so the arithmetic is long, never the 16-bit int of the AVR.',
      'INT32_MIN is written (-2147483647L - 1L): 2147483648L does not fit a long and would make the expression long long.',
      'A literal outside -2147483648..2147483647 is a compile error (value-out-of-range).',
    ],
    modules: ['U-M1'],
    cpp: cpp('<n>L', { variants: ['(-2147483647L - 1L)'] }),
    levels: levels('R2.3', ['EMU-10', 'EMU-13']),
    fields: open({
      call: field([compiles('300L, (-2147483647L - 1L).')]),
      range: field(
        [
          doc('ARD-09', 'An integer constant followed by an L is a long.'),
          language('CXX-04', 'A literal has the first type of its suffix in which its value fits: 2147483648L is not a long.'),
        ],
        ['EMU-10', 'CC-01'],
      ),
      error: byDomain('A literal outside int32 is outside the domain: a compile error.'),
    }),
    domain: domain({ n: 'int' }, between('n', -2_147_483_648, 2_147_483_647)),
  },
  {
    id: 'U-05',
    capability: 'add, subtract, multiply (int32, wrap)',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: [
      'Never a plain + - * on a learner value: avr-gcc 7.3 folds signed overflow as impossible (x + 1L > x is 1 at INT32_MAX), so the board would not wrap.',
      'The helpers compute in unsigned long and convert back: every pair of longs has a result, and it wraps.',
      'The simulator multiplies with Math.imul: (a * b) | 0 loses the low bits of a product beyond 2^53 ((2147483647 * 2147483647) | 0 is 0, the board gives 1).',
      sequencing,
    ],
    modules: ['U-M1'],
    cpp: cpp('add32(<a>, <b>) · sub32(<a>, <b>) · mul32(<a>, <b>)', { variants: sequencedForms, helpers: ['int32'] }),
    levels: levels('R2.3', ['EMU-11', 'EMU-13', 'EMU-15']),
    fields: open({
      call: field([compiles('add32, sub32 and mul32 compile and inline.'), sequencedCall('(_s1 = <read>, _s2 = <read>, sub32(_s1, _s2)).')]),
      content: sequencedContent('The two arguments of add32, sub32 and mul32'),
      range: na('Every int32 pair has a result.'),
      return: field(
        [
          language('CXX-02', 'unsigned long arithmetic is modulo 2^32: it never overflows.'),
          language('CXX-03', 'GCC converts an out-of-range unsigned long back to long modulo 2^32.'),
        ],
        ['EMU-11', 'EMU-13'],
      ),
      error: field([language('CXX-02', 'Unsigned arithmetic does not overflow: no undefined behaviour, no error.')], ['EMU-11']),
    }),
  },
  {
    id: 'U-06',
    capability: 'divide (truncating)',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['Truncates toward zero (-7 / 2 = -3).', 'INT32_MIN / -1 is INT32_MIN (wrap).', 'x / 0 is 0 on the board and in the simulator, which also warns division-by-zero once per block per run.', sequencing],
    modules: ['U-M1'],
    cpp: cpp('div32(<a>, <b>)', { variants: sequencedForms, helpers: ['int32'] }),
    levels: levels('R2.3', ['EMU-10', 'EMU-13', 'EMU-15']),
    fields: open({
      call: field([compiles('div32 compiles.'), sequencedCall('(_s1 = <read>, _s2 = <read>, div32(_s1, _s2)).')]),
      content: sequencedContent('The two arguments of div32'),
      round: field([language('CXX-01', 'The quotient is the algebraic quotient with any fractional part discarded.')], ['EMU-10']),
      return: field([language('CXX-01', 'div32 only evaluates a / b when b is neither 0 nor -1, where the quotient is defined; -1 is neg32.')], ['EMU-13']),
      error: field([language('CXX-01', 'Division by zero and INT32_MIN / -1 are undefined in C++: div32 never evaluates them and returns 0 and neg32(a).')], ['EMU-10', 'EMU-13']),
    }),
  },
  {
    id: 'U-07',
    capability: 'remainder (sign of the dividend)',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['The remainder takes the sign of the dividend (-7 % 2 = -1, 7 % -2 = 1).', 'x % -1 is 0, INT32_MIN % -1 included.', 'x % 0 is 0, with the division-by-zero warning in the simulator.', sequencing],
    modules: ['U-M1'],
    cpp: cpp('mod32(<a>, <b>)', { variants: sequencedForms, helpers: ['int32'] }),
    levels: levels('R2.3', ['EMU-10', 'EMU-13', 'EMU-15']),
    fields: open({
      call: field([compiles('mod32 compiles.'), sequencedCall('(_s1 = <read>, _s2 = <read>, mod32(_s1, _s2)).')]),
      content: sequencedContent('The two arguments of mod32'),
      round: field([language('CXX-01', '(a/b)*b + a%b == a with a truncated quotient: the remainder has the sign of a.'), doc('ARD-15', 'If the first operand is negative, the result is negative (or zero).')], ['EMU-10']),
      return: field([language('CXX-01', 'mod32 only evaluates a % b when b is neither 0 nor -1, where it is defined.')], ['EMU-13']),
      error: field([language('CXX-01', 'a % 0 and INT32_MIN % -1 are undefined in C++: mod32 never evaluates them and returns 0.')], ['EMU-10', 'EMU-13']),
    }),
  },
  {
    id: 'U-08',
    capability: 'negate',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['-INT32_MIN is INT32_MIN (wrap).'],
    modules: ['U-M1'],
    cpp: cpp('neg32(<a>)', { helpers: ['int32'] }),
    levels: levels('R2.3', ['EMU-13']),
    fields: open({
      call: field([compiles('neg32 compiles.')]),
      return: field([language('CXX-02', '0UL - (unsigned long)a is modulo 2^32.'), language('CXX-03', 'and converts back to long modulo 2^32.')], ['EMU-10', 'EMU-13']),
    }),
  },
  {
    id: 'U-09',
    capability: 'compare',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['< <= > >= == != on two longs: no arithmetic, so no overflow.', sequencing],
    modules: ['U-M1'],
    cpp: cpp('(<a> < <b>) · (<a> <= <b>) · (<a> > <b>) · (<a> >= <b>) · (<a> == <b>) · (<a> != <b>)', { variants: sequencedForms }),
    levels: levels('R2.3', ['EMU-13', 'EMU-15']),
    fields: open({
      call: field([compiles('The six comparisons compile on long operands.'), sequencedCall('(_s1 = <read>, _s2 = <read>, (_s1 < _s2)).')]),
      content: sequencedContent('The two operands of a comparison'),
      return: field([language('CXX-05', 'A comparison is a bool.')], ['EMU-13']),
    }),
  },
  {
    id: 'U-10',
    capability: 'and, or, not, true, false',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['&& and || evaluate the right side only when needed, as in the simulator.'],
    modules: ['U-M1'],
    cpp: cpp('(<a> && <b>) · (<a> || <b>) · !(<a>) · true · false'),
    levels: levels('R2.3', ['EMU-13']),
    fields: open({
      call: field([compiles('&&, ||, ! and the bool literals compile.')]),
      return: field([language('CXX-05', '&& skips the right side when the left is false, || when it is true; the result is a bool.')], ['EMU-13']),
    }),
  },
  {
    id: 'U-11',
    capability: 'if / else if / else',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: [],
    modules: ['U-M1'],
    cpp: cpp('if (<c>) {\n  <body>\n} else if (<c2>) {\n  <body2>\n} else {\n  <body3>\n}'),
    levels: levels('R2.3', ['EMU-13']),
    fields: open({ call: field([compiles('if / else if / else compiles.')]) }),
  },
  {
    id: 'U-12',
    capability: 'repeat N times',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['N is evaluated once, before the loop; N <= 0 runs no iteration.', '_r < _n with _n <= INT32_MAX: _r += 1L never overflows.'],
    modules: ['U-M1'],
    cpp: cpp('{ const long _n = (<count>); for (long _r = 0L; _r < _n; _r += 1L) { <body> } }'),
    levels: levels('R2.3', ['EMU-13']),
    fields: open({
      call: field([compiles('The repeat form compiles; nested repeats shadow _n and _r in their own block.')]),
      range: field([language('CXX-07', 'The for statement tests _r < _n before each iteration: N <= 0 runs none.')], ['EMU-13']),
      content: field([language('CXX-07', 'const long _n = (<count>); is one full-expression, evaluated once before the loop.')], ['EMU-13']),
    }),
  },
  {
    id: 'U-13',
    capability: 'while',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['No hidden delay: a while without wait spins on the board; the simulator charges NODE_US per node and never runs ahead of the world.'],
    modules: ['U-M1'],
    cpp: cpp('while (<c>) {\n  <body>\n}'),
    levels: levels('R2.3', ['EMU-13']),
    fields: open({ call: field([compiles('while compiles.')]) }),
  },
  {
    id: 'U-14',
    capability: 'count up',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'RESTRICTED',
    restrictions: [
      'start, then end, each evaluated once, before the loop (the order of the Yolo:Bit contract §3.3); step 1.',
      'The variable takes each value; after the loop it keeps the last one, or its old value when start > end.',
      'end <= 2147483646, so _c += 1L never overflows: a literal beyond is a compile error, a computed one is out-of-domain.',
      'A literal start greater than a literal end is a compile error (descending-range-not-supported).',
    ],
    modules: ['U-M1'],
    cpp: cpp('{ const long _from = (<start>); const long _to = (<end>); for (long _c = _from; _c <= _to; _c += 1L) { <var> = _c; <body> } }'),
    levels: levels('R2.3', ['EMU-10', 'EMU-13']),
    fields: open({
      call: field([compiles('The count up form compiles; nested ones shadow _from, _to and _c in their own block.')]),
      range: byDomain('end > 2147483646 is outside the domain.'),
      clamp: byDomain('Nothing is clamped: out of the domain is refused.'),
      error: byDomain('Outside the domain there is no behaviour to describe.'),
      content: field(
        [language('CXX-07', 'The two declarations are two full-expressions: start is evaluated, then end, once each, before the for statement; the body sees each value in turn.')],
        ['EMU-10', 'EMU-13'],
      ),
    }),
    domain: {
      args: { start: 'int', end: 'int' },
      evaluation: { order: ['start', 'end'], once: true, checkEach: 'after-own-evaluation' },
      compileTime: [
        { when: { le: [arg('end'), num(2_147_483_646)] }, diagnostic: 'value-out-of-range' },
        { when: { le: [arg('start'), arg('end')] }, diagnostic: 'descending-range-not-supported' },
      ],
      runtime: { le: [arg('end'), num(2_147_483_646)] },
    },
  },
  {
    id: 'U-15',
    capability: 'print a number or a truth value',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: [
      'Serial.begin(9600) is the first line of setup() when the program prints; D0 and D1 are then reserved.',
      'A number prints its decimal digits; a truth value prints 1 or 0, never true / false.',
      'Time: the bytes queue (64) and leave at one per 1040 µs; a print that finds the queue full waits (contract §7).',
    ],
    modules: ['U-M1'],
    cpp: cpp('Serial.println(<expr>);', { setup: ['Serial.begin(9600);'] }),
    levels: levels('R2.3', ['EMU-08', 'EMU-10', 'EMU-13']),
    fields: open({
      call: field([compiles('Serial.begin(9600); in setup, Serial.println(<long or bool>).')]),
      block: field([doc('ARD-08', 'A write returns at once while the transmit buffer has room, and blocks while it is full.')], ['EMU-08']),
      content: field(
        [doc('ARD-14', 'Numbers are printed using an ASCII character for each digit.'), language('CXX-06', 'A bool becomes the int 1 or 0 before it is printed.')],
        ['EMU-10', 'EMU-13'],
      ),
    }),
  },
  {
    id: 'U-16',
    capability: 'print text',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'RESTRICTED',
    restrictions: [
      'Text is only printed (no text variables): Serial.println(F("…")) keeps it in flash, not in RAM.',
      'UTF-8 as typed ("Xin chào" is 9 bytes); " and \\ are escaped; a control character (below 0x20) is a compile error.',
      'The time of a print counts bytes, not letters.',
    ],
    modules: ['U-M1'],
    cpp: cpp('Serial.println(F("<text>"));', { setup: ['Serial.begin(9600);'] }),
    levels: levels('R2.3', ['EMU-13']),
    fields: open({
      call: field([compiles('Serial.println(F("…")) with \\" and \\\\ escapes and UTF-8 text.')]),
      range: byDomain('Control characters are outside the domain: a compile error.'),
      block: field([doc('ARD-08', 'As U-15: the text queues and leaves at the baud rate.')], ['EMU-08']),
      content: field([doc('ARD-14', 'F() strings are printed from flash as they are.')], ['EMU-13']),
    }),
    domain: structural({ text: 'str' }),
  },
  {
    id: 'U-17',
    capability: 'print a join of text and numbers',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['Each part is its own Serial.print, the last a Serial.println; text parts use F().'],
    modules: ['U-M1'],
    cpp: cpp('Serial.print(<part>); … Serial.println(<last>);', { variants: ['Serial.print(F("<text>"));'], setup: ['Serial.begin(9600);'] }),
    levels: levels('R2.3', ['EMU-13']),
    fields: open({
      call: field([compiles('Serial.print(F("x = ")); Serial.println(x);')]),
      block: field([doc('ARD-08', 'As U-15.')], ['EMU-08']),
      content: field([doc('ARD-14', 'The parts are printed one after another, then the line ends.')], ['EMU-13']),
    }),
  },
  {
    id: 'U-18',
    capability: 'wait (ms)',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['ms is 0..60000 (a limit of the domain, not of the board).', 'The board waits ms × 1000 µs plus 5..13 µs; the simulator charges ms × 1000 + delayOverhead.'],
    modules: ['U-M1'],
    cpp: cpp('delay(<ms>);'),
    levels: levels('R2.3', ['EMU-01', 'EMU-08', 'EMU-13']),
    fields: open({
      call: field([compiles('delay(<long>) compiles; the long converts to unsigned long within the domain.')]),
      unit: field([doc('ARD-17', 'delay takes milliseconds.')], ['EMU-01']),
      range: byDomain('Values outside 0..60000 are outside the domain.'),
      clamp: byDomain('A literal outside is a compile error, a computed one out-of-domain.'),
      block: field([doc('ARD-17', 'delay pauses the program for that time.')], ['EMU-01', 'EMU-08']),
      error: byDomain('Outside the domain there is no behaviour to describe.'),
    }),
    domain: domain({ ms: 'int' }, between('ms', 0, 60_000)),
  },
  {
    id: 'U-19',
    capability: 'time since start (millis)',
    tier: tierAdvanced,
    profiles: ADVANCED,
    eligibility: 'ELIGIBLE',
    restrictions: [
      '(long)millis(): compared with a long, an unsigned millis() would turn -1 into 4294967295.',
      'The board counts one per 1024 µs and carries 3/125: millis = n + floor(3n / 125), n = floor(t / 1024 µs) from setup(). The simulator computes the same.',
      'Wraps to negative after 2^31 ms (24.8 days), far beyond a run.',
    ],
    modules: ['U-M1'],
    cpp: cpp('(long)millis()'),
    levels: levels('R1.3, R2.3', ['EMU-12', 'EMU-13']),
    fields: open({
      call: field([compiles('(long)millis() compiles.')]),
      unit: field([doc('ARD-05', 'Milliseconds since the program started.')], ['EMU-12']),
      range: field([doc('ARD-05', 'unsigned long, overflows after about 50 days'), language('CXX-03', 'the cast to long is modulo 2^32: negative from 2^31 ms')], ['EMU-10']),
      round: field([trace('EMU-12', 'millis lags the true time by up to 2.45 ms: n + floor(3n / 125) with n Timer0 overflows of 1024 µs.')]),
      return: field([trace(['EMU-12', 'EMU-13'], 'The value printed equals the model at the time of the read, 250 of 250 reads.')]),
      block: field([costs('millis() takes 1.1875 µs')]),
    }),
  },
  {
    id: 'U-20',
    capability: 'motor speed (H-bridge EN/IN1/IN2)',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: [
      'speed -100..100; outside is clamped, with a warning once per role per run; a literal is written clamped.',
      'duty = round(|speed| × 255 / 100) on EN; speed > 0: IN1 HIGH, IN2 LOW; speed < 0: IN1 LOW, IN2 HIGH; 0: both IN LOW and EN LOW.',
      'EN must be a PWM pin whose timer no other module holds (ref-uno-rover@0: D5 and D6, Timer0).',
    ],
    modules: ['U-M1'],
    cpp: cpp('motorSet(<ROLE>_EN, <ROLE>_IN1, <ROLE>_IN2, <speed>);', {
      helpers: ['hbridge-en-in1-in2'],
      setup: ['pinMode(<ROLE>_EN, OUTPUT);', 'pinMode(<ROLE>_IN1, OUTPUT);', 'pinMode(<ROLE>_IN2, OUTPUT);'],
    }),
    levels: levels('R1.4', ['EMU-02', 'EMU-07', 'EMU-13']),
    fields: open({
      call: field([compiles('motorSet(EN, IN1, IN2, speed) with the pins of the kit as #define.')]),
      unit: field([doc('ARD-01', 'The EN duty is analogWrite 0..255.'), trace('EMU-02', 'D5/D6 run at 976.5625 Hz.')]),
      range: field([trace('EMU-13', 'Full speed either way is duty 255 (EN HIGH).')]),
      default: field([trace('EMU-02', 'pinMode OUTPUT in setup drives EN and IN LOW: the motor starts stopped.')]),
      clamp: field([trace('EMU-13', 'speed 150 drives EN HIGH, as 100 does.')]),
      round: field([trace(['EMU-02', 'EMU-13'], 'duty 50 → 128, 30 → 77, 1 → 3, 60 → 153, 40 → 102 (half up).')]),
      block: field([costs('two digitalWrite and one analogWrite')]),
      yield: field([backgroundPwm]),
      content: field([trace(['EMU-02', 'EMU-13'], 'IN levels follow the sign; 0 puts both IN and EN LOW.')]),
    }),
  },
  {
    id: 'U-21',
    capability: 'drive: forward, backward, spin left, spin right',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: [
      'speed is evaluated once; forward: left +s, right +s; backward: -s, -s; spin left: -s, +s; spin right: +s, -s (neg32, then clamped as U-20).',
      'Needs both motorLeft and motorRight in the kit (capability-unavailable otherwise).',
    ],
    modules: ['U-M1'],
    cpp: cpp('{ const long _s = (<speed>); motorSet(MOTOR_LEFT_EN, MOTOR_LEFT_IN1, MOTOR_LEFT_IN2, <_s|neg32(_s)>); motorSet(MOTOR_RIGHT_EN, MOTOR_RIGHT_IN1, MOTOR_RIGHT_IN2, <_s|neg32(_s)>); }', {
      helpers: ['hbridge-en-in1-in2', 'int32'],
    }),
    levels: levels('R1.4', ['EMU-13']),
    fields: open({
      call: field([compiles('The drive form compiles with both motors of the kit.')]),
      clamp: field([trace('EMU-13', 'As U-20: each motor clamps its own speed.')]),
      round: field([trace('EMU-13', 'forward 60 → duty 153 on both EN.')]),
      block: field([costs('two motorSet calls')]),
      yield: field([backgroundPwm]),
      content: field([trace('EMU-13', 'forward 60: D7 H D8 L, D4 H D2 L; spin left 40: D7 L D8 H, D4 H D2 L, duty 102 on both.')]),
    }),
  },
  {
    id: 'U-22',
    capability: 'stop the robot',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['Both motors 0: all four IN pins and both EN LOW.'],
    modules: ['U-M1'],
    cpp: cpp('motorSet(MOTOR_LEFT_EN, MOTOR_LEFT_IN1, MOTOR_LEFT_IN2, 0L); motorSet(MOTOR_RIGHT_EN, MOTOR_RIGHT_IN1, MOTOR_RIGHT_IN2, 0L);', { helpers: ['hbridge-en-in1-in2'] }),
    levels: levels('R1.4', ['EMU-02', 'EMU-13']),
    fields: open({
      call: field([compiles('Two motorSet(…, 0L) calls.')]),
      block: field([costs('two motorSet calls')]),
      content: field([trace(['EMU-02', 'EMU-13'], 'All six pins LOW.')]),
    }),
  },
  {
    id: 'U-23',
    capability: 'servo angle',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: [
      'angle 0..180; outside is clamped (with a warning once per role per run) before Servo.write, which reads 544 and above as microseconds.',
      'attach in setup(), followed by write(90): the servo starts at 90° on the board and in the simulator.',
      'Servo holds Timer1: no PWM on D9 or D10 while the kit has a servo (U-48).',
    ],
    modules: ['U-M1', 'U-M2'],
    cpp: cpp('servoSet(<role>, <angle>);', {
      includes: ['#include <Servo.h>'],
      libraries: [core, servoLibrary],
      helpers: ['servo-lib'],
      globals: ['Servo <role>;'],
      setup: ['<role>.attach(<ROLE>_PIN);', '<role>.write(90);'],
    }),
    levels: levels('R1.4', ['EMU-03', 'EMU-07', 'EMU-13']),
    fields: open({
      call: field([compiles('Servo <role>; attach and write(90) in setup; servoSet(<role>, angle).')]),
      import: field([compiles('#include <Servo.h>')]),
      module: field([compiles('Servo 1.3.0 links.')]),
      unit: field([doc('ARD-13', 'write takes an angle from 0 to 180.'), trace('EMU-03', 'One pulse every 20 ms.')]),
      range: field([doc('ARD-13', '0° is 544 µs, 180° is 2400 µs by default.'), trace(['EMU-03', 'EMU-13'], '0° → 543–544 µs, 180° → 2399–2400 µs.')]),
      default: field([trace('EMU-13', 'write(90) right after attach: 1472 µs from the first pulse.')]),
      clamp: field([trace('EMU-13', '600 → 2400 µs (180°), -5 → 544 µs (0°).')]),
      round: field([trace('EMU-03', 'pulse = 544 + angle × 1856 / 180 µs, the division truncated (45° → 1008 µs).')]),
      block: field([costs('Servo.write takes 49.5 µs')]),
      yield: field([trace('EMU-03', 'A Timer1 interrupt makes the pulses while the program runs or waits.')]),
    }),
  },
  {
    id: 'U-24',
    capability: 'LED on / off',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['pinMode OUTPUT in setup(); the LED starts off.'],
    modules: ['U-M1'],
    cpp: cpp('digitalWrite(<ROLE>_PIN, (<on>) ? HIGH : LOW);', { setup: ['pinMode(<ROLE>_PIN, OUTPUT);'] }),
    levels: levels('R1.4', ['EMU-01', 'EMU-13']),
    fields: open({
      call: field([compiles('digitalWrite(PIN, (cond) ? HIGH : LOW).')]),
      default: field([trace('EMU-01', 'pinMode OUTPUT drives the pin LOW.')]),
      block: field([costs('digitalWrite takes 4.5625 µs')]),
      content: field([trace('EMU-13', 'HIGH when on, LOW when off.')]),
    }),
  },
  {
    id: 'U-25',
    capability: 'buzzer tone (Hz, ms)',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: [
      'hz 31..4000, ms 1..60000; outside is clamped with a warning once per role per run (ms 0 would play forever).',
      'Does not block: the tone plays in the background for ms; a new tone on the same pin replaces it.',
      'Tone holds Timer2: no PWM on D3 or D11 while the kit has a buzzer (U-48).',
      'The board plays floor(2 × hz × ms / 1000) half-periods of the nearest frequency the timer makes (440 → 440.141 Hz).',
      'hz, then ms, each once (§3.5): when both read the robot, the call is (_s1 = <read>, …, buzzerTone(<ROLE>_PIN, <hz>, <ms>)); with the reads sequenced left to right, since avr-gcc evaluates call arguments right to left (EMU-15).',
    ],
    modules: ['U-M1'],
    cpp: cpp('buzzerTone(<ROLE>_PIN, <hz>, <ms>);', { variants: ['(_s<k> = <read>, … buzzerTone(<ROLE>_PIN, <hz>, <ms>));'], helpers: ['buzzer-tone'] }),
    levels: levels('R1.4', ['EMU-05', 'EMU-07', 'EMU-13', 'EMU-15']),
    fields: open({
      call: field([compiles('buzzerTone(PIN, hz, ms) compiles.'), sequencedCall('(_s1 = <read>, _s2 = <read>, buzzerTone(PIN, _s1, _s2));')]),
      unit: field([doc('ARD-03', 'Frequency in Hz, duration in milliseconds.')], ['EMU-13']),
      range: field([doc('ARD-03', 'No tone lower than 31 Hz.'), trace('EMU-13', '4000 Hz plays exactly.')]),
      clamp: field([trace('EMU-13', '10 Hz → 31 Hz; 9000 → 4000 Hz; 0 ms → 1 ms.')]),
      round: field([trace('EMU-13', '440 → 440.141 Hz, 880 → 880.282 Hz; 31 Hz × 40 ms plays 2 half-periods.')]),
      block: field([doc('ARD-03', 'tone is non-blocking.'), trace('EMU-05', 'tone(10, 1000, 50) returns and plays 49.36 ms.')]),
      yield: field([trace(['EMU-05', 'EMU-13'], 'A Timer2 interrupt toggles the pin while the program runs or waits.')]),
      content: field([
        doc('ARD-03', 'A tone on the same pin sets its frequency.'),
        trace('EMU-13', 'A second buzzerTone plays 880 Hz for its own 30 ms.'),
        language('CXX-10', 'The arguments of a call are indeterminately sequenced: hz and ms have no order of their own in C++.'),
        trace('EMU-15', 'f3(10, se(7L), se(8L)) evaluates 8 before 7; (_s1 = se(7L), _s2 = se(8L), f3(10, _s1, _s2)) evaluates 7, then 8.'),
      ]),
    }),
  },
  {
    id: 'U-26',
    capability: 'buzzer stop',
    tier: tierAdvanced,
    profiles: ADVANCED,
    eligibility: 'ELIGIBLE',
    restrictions: ['noTone: the pin goes LOW at once.'],
    modules: ['U-M1'],
    cpp: cpp('noTone(<ROLE>_PIN);'),
    levels: levels('R1.4', ['EMU-05', 'EMU-13']),
    fields: open({
      call: field([compiles('noTone(PIN).')]),
      block: field([costs('noTone takes 6.375 µs')]),
      content: field([trace(['EMU-05', 'EMU-13'], 'The tone stops and the pin stays LOW.')]),
    }),
  },
  {
    id: 'U-27',
    capability: 'ultrasonic distance (cm)',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: [
      'cm = pulseIn(ECHO, HIGH, 30000) / 58, truncated, clamped to 2..400; no echo → 400.',
      'Time: the trigger, the wait for the echo, the echo, then 3.25 µs; no echo costs 20752 µs, not 30000 (the wait loop is 11 cycles, not 16).',
      'The board reads 0..1.1 % short (interrupts are not counted; 2..3 % while a tone plays): its cm may be up to 1.1 % + 1 cm lower than the exact distance (3 % + 1 cm with a tone). Scenario checks allow 3 % + 1 cm.',
    ],
    modules: ['U-M1'],
    cpp: cpp('ultrasonicCm(<ROLE>_TRIG, <ROLE>_ECHO)', { helpers: ['hcsr04-pulsein'], setup: ['pinMode(<ROLE>_TRIG, OUTPUT);', 'pinMode(<ROLE>_ECHO, INPUT);'] }),
    levels: levels('R1.4, R3', ['EMU-03', 'EMU-07', 'EMU-13']),
    fields: open({
      call: field([compiles('ultrasonicCm(TRIG, ECHO) compiles.')]),
      unit: field([doc('ARD-04', 'pulseIn returns microseconds.'), trace('EMU-03', '1160 µs → 19 or 20 cm at 58 µs per cm.')]),
      range: field([trace(['EMU-03', 'EMU-13'], '2..400 cm.')]),
      clamp: field([trace('EMU-03', 'An echo of 116 µs (1 cm) gives 2.')]),
      round: field([trace('EMU-03', 'Truncated; pulseIn reads 0..1.10 % short, so 1160 µs reads 1155 → 19 cm.')]),
      block: field([claim('disassembly', 'CC-04', 'The wait loop is 11 cycles and the count loop 16, from one budget of 30000.'), trace(['EMU-03', 'EMU-13'], 'call = trigger + wait + echo + 3.25 µs (+ the division): 1675.5625 µs at 450 + 1160; 20812 µs without echo.')]),
      return: field([doc('ARD-04', 'pulseIn returns 0 on a timeout.'), trace(['EMU-03', 'EMU-13'], 'No echo, or an echo longer than the timeout, gives 400.')]),
      error: na('No error: a missing echo is the distance 400.'),
    }),
  },
  {
    id: 'U-28',
    capability: 'line sensor sees dark',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['Driver line-digital: dark when the pin reads LOW if the kit says activeLow, HIGH otherwise; the generator writes the level the kit gives.'],
    modules: ['U-M1'],
    cpp: cpp('(digitalRead(<ROLE>_PIN) == <LOW|HIGH>)', { setup: ['pinMode(<ROLE>_PIN, INPUT);'] }),
    levels: levels('R1.4, R3', ['EMU-13']),
    fields: open({
      call: field([compiles('(digitalRead(A0) == HIGH), (digitalRead(A1) == LOW).')]),
      block: field([costs('digitalRead on A0..A2 takes 3.9375 µs')]),
      return: field([trace('EMU-13', 'A bool: 1 when the pin is at the dark level.')]),
      content: field([trace('EMU-13', 'HIGH pin with activeLow false → 1; HIGH pin with activeLow true → 0.')]),
    }),
  },
  {
    id: 'U-29',
    capability: 'line sensor raw value',
    tier: tierAdvanced,
    profiles: ADVANCED,
    eligibility: 'ELIGIBLE',
    restrictions: ['analogRead 0..1023 on an analog pin; the first read of a run costs 201.8125 µs, the next ones 105.8125 µs.'],
    modules: ['U-M1'],
    cpp: cpp('(long)analogRead(<ROLE>_PIN)'),
    levels: levels('R1.4, R3', ['EMU-07', 'EMU-13']),
    fields: open({
      call: field([compiles('(long)analogRead(A2).')]),
      range: field([doc('ARD-02', '0..1023.'), trace('EMU-07', '0 V → 0, 5 V → 1023.')]),
      round: field([doc('DS-01', 'ADC = VIN · 1024 / VREF, as an integer.')], ['EMU-07']),
      block: field([costs('analogRead takes 105.8125 µs (first 201.8125)'), doc('DS-01', '13 ADC clocks, 25 for the first conversion.')]),
      return: field([trace(['EMU-07', 'EMU-13'], 'The ADC value as a long.')]),
    }),
  },
  {
    id: 'U-30',
    capability: 'button pressed',
    tier: tierBoth,
    profiles: BOTH,
    eligibility: 'ELIGIBLE',
    restrictions: ['Driver button-pullup: INPUT_PULLUP in setup(); pressed when the pin reads LOW. No debounce.'],
    modules: ['U-M1'],
    cpp: cpp('(digitalRead(<ROLE>_PIN) == LOW)', { setup: ['pinMode(<ROLE>_PIN, INPUT_PULLUP);'] }),
    levels: levels('R1.4', ['EMU-07', 'EMU-13']),
    fields: open({
      call: field([compiles('pinMode(PIN, INPUT_PULLUP); (digitalRead(PIN) == LOW).')]),
      default: field([doc('ARD-16', 'INPUT_PULLUP turns on the internal pull-up: a released button reads HIGH.')]),
      block: field([costs('digitalRead on D3 (a Timer2 pin) takes 5.0625 µs')]),
      return: field([trace(['EMU-07', 'EMU-13'], 'Released → 0, pressed (pin LOW) → 1.')]),
    }),
  },
  {
    id: 'U-31',
    capability: 'digital write (raw pin)',
    tier: tierAdvanced,
    profiles: ADVANCED,
    eligibility: 'RESTRICTED',
    restrictions: ['Only a pin the kit leaves free and that is not reserved (D0/D1 with Serial): otherwise a compile error pin-unavailable.', 'pinMode OUTPUT in setup().'],
    modules: ['U-M1'],
    cpp: cpp('digitalWrite(<pin>, (<v>) ? HIGH : LOW);', { setup: ['pinMode(<pin>, OUTPUT);'] }),
    levels: levels('R1.2, R1.3', ['EMU-13']),
    fields: open({
      call: field([compiles('digitalWrite(A3, (cond) ? HIGH : LOW).')]),
      range: byDomain('A pin the kit uses, or D0/D1 with Serial, is outside the domain.'),
      block: field([costs('digitalWrite takes 4.5625 µs (5.625 on a timer pin)')]),
      content: field([trace('EMU-13', 'A3 HIGH, then LOW.')]),
    }),
    domain: structural({ pin: 'str' }),
  },
  {
    id: 'U-32',
    capability: 'PWM write 0..255 (raw pin)',
    tier: tierAdvanced,
    profiles: ADVANCED,
    eligibility: 'RESTRICTED',
    restrictions: [
      'value 0..255; outside is clamped with a warning once per pin per run.',
      'On a PWM pin: duty value/255 at 976.5625 Hz (D5, D6) or 490.196 Hz (D3, D9, D10, D11).',
      'On a pin without PWM: 128 and above → HIGH, below → LOW, with a not-pwm warning.',
      'A PWM pin whose timer the kit\'s servo (T1: D9, D10) or buzzer (T2: D3, D11) holds is refused: timer-claimed (U-48).',
      'Only a pin the kit leaves free (ref-uno-rover@0 leaves no PWM pin free: A3..A5 are not-pwm).',
    ],
    modules: ['U-M1'],
    cpp: cpp('pwmWrite(<pin>, <value>);', { helpers: ['pwm-write'] }),
    levels: levels('R1.2, R1.3', ['EMU-06', 'EMU-13']),
    fields: open({
      call: field([compiles('pwmWrite(A3, value).')]),
      unit: field([doc('ARD-01', 'value is the duty cycle, 0 (always off) to 255 (always on).'), trace('EMU-06', '490.196 Hz and 976.5625 Hz.')]),
      range: field([trace('EMU-06', 'duty v/255 on every PWM pin.')]),
      clamp: field([trace('EMU-13', '300 → 255 (HIGH), -4 → 0 (LOW).')]),
      block: field([costs('analogWrite takes 7.6875 µs, 11.875 µs on a pin without PWM')]),
      yield: field([backgroundPwm]),
      error: byDomain('A PWM pin on a claimed timer is outside the domain: timer-claimed.'),
      content: field([trace(['EMU-06', 'EMU-13'], 'Without PWM: 127 → LOW, 128 → HIGH, 100 → LOW.')]),
    }),
    domain: structural({ pin: 'str', value: 'int' }),
  },
  {
    id: 'U-33',
    capability: 'digital read (raw pin)',
    tier: tierAdvanced,
    profiles: ADVANCED,
    eligibility: 'RESTRICTED',
    restrictions: [
      'Only a pin the kit wires to an input module (button, line, echo): a floating pin reads at random on the board, so it is refused (pin-unavailable).',
      'Never a PWM output pin: digitalRead stops its PWM on the board.',
      'setup() gives the pin the pinMode of its module\'s driver (<mode>: INPUT_PULLUP for the button, INPUT for a line sensor or the echo), whether or not the program uses the module: a released button reads HIGH.',
    ],
    modules: ['U-M1'],
    cpp: cpp('(digitalRead(<pin>) == HIGH)', { setup: ['pinMode(<pin>, <mode>);'] }),
    levels: levels('R1.2, R1.3', ['EMU-13']),
    fields: open({
      call: field([compiles('(digitalRead(3) == HIGH).')]),
      default: field([
        doc('ARD-16', 'INPUT_PULLUP turns on the internal pull-up: the button pin reads HIGH while it is released.'),
        trace('EMU-13', 'With the button\'s pinMode(3, INPUT_PULLUP) in setup(), (digitalRead(3) == HIGH) reads the button: 0 while it is pressed.'),
      ]),
      range: byDomain('A floating pin, or an output pin, is outside the domain.'),
      block: field([costs('digitalRead takes 3.9375 µs (5.0625 on a timer pin)')]),
      return: field([trace('EMU-13', 'D3 held LOW by the pressed button: (digitalRead(3) == HIGH) is 0.')]),
    }),
    domain: structural({ pin: 'str' }),
  },
  {
    id: 'U-34',
    capability: 'analog read 0..1023 (raw pin)',
    tier: tierAdvanced,
    profiles: ADVANCED,
    eligibility: 'RESTRICTED',
    restrictions: ['A0..A5 only, and only one the kit wires to an analog module (line sensors).'],
    modules: ['U-M1'],
    cpp: cpp('(long)analogRead(<pin>)'),
    levels: levels('R1.2, R1.3', ['EMU-07', 'EMU-13']),
    fields: open({
      call: field([compiles('(long)analogRead(A2).')]),
      range: field([doc('ARD-02', '0..1023.')], ['EMU-07']),
      round: field([doc('DS-01', 'ADC = VIN · 1024 / VREF.')]),
      block: field([costs('analogRead takes 105.8125 µs')]),
      return: field([trace('EMU-13', '2.5 V → 512.')]),
    }),
    domain: structural({ pin: 'str' }),
  },
];

// --- Rows that are not shown (contract §10.2) ------------------------------------------------------

const closedRow = (id: string, capability: string, eligibility: 'EXCLUDED' | 'DEFERRED', exclusionReason: string, partial: Partial<Record<OfField, FieldEntry>> = {}, rowLevels: ClaimLevels = notOfferedLevels): ConstructContract => ({
  id,
  capability,
  tier: {},
  profiles: [],
  eligibility,
  restrictions: [],
  modules: ['U-M1'],
  levels: rowLevels,
  fields: closed(partial),
  exclusionReason,
});

const closedRows: readonly ConstructContract[] = [
  closedRow('U-40', 'float numbers, real division', 'EXCLUDED', 'Basic has no float (R0.3); Advanced v0 neither: the numeric model is cxx-int32.'),
  closedRow('U-41', 'text variables, String objects', 'EXCLUDED', 'Text is only printed; String would use the 2 KB of RAM and fragment it.'),
  closedRow('U-42', 'learner functions', 'DEFERRED', 'Not among the R2.2 blocks; a function domain like Yolo:Bit FN1–FN10 will be written when the block exists.'),
  closedRow('U-43', 'interrupts and events (attachInterrupt)', 'DEFERRED', 'The program model is setup + loop; events wait for their own gate.'),
  closedRow('U-44', 'reading the serial monitor', 'EXCLUDED', 'No input from the lab to the program in v0.'),
  closedRow('U-45', 'random numbers', 'EXCLUDED', 'Not in the v0 IR; a seeded model would have to match the AVR random().'),
  closedRow('U-46', 'I²C modules (Wire)', 'DEFERRED', 'WireIO exists in the driver interface, but ref-uno-rover@0 has no I²C module.'),
  closedRow('U-47', 'delayMicroseconds, raw pulseIn, micros', 'EXCLUDED', 'Only the drivers use them; no block in v0.'),
  closedRow(
    'U-48',
    'PWM on a timer a servo or a tone holds',
    'EXCLUDED',
    'VERIFIED (R0.4): with a servo, analogWrite(9/10) gives no PWM (the pin stays LOW, also after detach); with a tone, D3/D11 PWM stops and analogWrite(11) changes the tone to 2475 Hz. The program would not do what it says: refused with timer-claimed.',
    {
      content: field([
        trace('EMU-04', 'Servo on Timer1: analogWrite(10, 200) gives a constant LOW; after detach still LOW.'),
        trace('EMU-05', 'tone on Timer2: D3/D11 LOW; analogWrite(11, 100) moves the tone from 1000 to 2475.248 Hz; noTone followed by a new analogWrite gives the PWM back.'),
        trace('EMU-14', 'After noTone, or a tone that ends by itself, D3/D11 have no PWM until a new analogWrite.'),
        doc(['ARD-12', 'ARD-03'], 'Servo disables PWM on pins 9 and 10; tone interferes with PWM on pins 3 and 11.'),
      ]),
    },
    { L1: { status: 'PENDING', by: 'R1.2: timer-claimed' }, L2: { status: 'PASS', evidence: ['CC-01'] }, L2e: { status: 'PASS', evidence: ['EMU-04', 'EMU-05'] }, L3: { status: 'PENDING', by: 'M06' } },
  ),
  closedRow('U-49', 'Servo.detach, writeMicroseconds, a servo on a pin outside the kit', 'EXCLUDED', 'detach leaves Timer1 in normal mode (no PWM on D9/D10 until reset, EMU-04); the block sets angles only.'),
  closedRow('U-50', 'tone on a pin other than the buzzer, two tones at once', 'EXCLUDED', 'The core plays one tone at a time (ARD-03); the buzzer role owns it.'),
];

// --- C2 parity (contract §0.1, §12, 0.1.4) ----------------------------------------------------------

/**
 * The open rows a C2 parity fixture covers (tests/parity/fixtures.ts, the `covers` of each fixture): their L2e also cites the parity
 * run of the generated sketch's HEX against the simulator, EMU-16. Since 0.1.5 every open row: the raw-pins golden runs U-31…U-34
 * and the fixture negate-drive U-08.
 */
export const UNO_PARITY_ROWS: readonly string[] = Array.from({ length: 34 }, (_, index) => `U-${String(index + 1).padStart(2, '0')}`);
const withParity = (row: ConstructContract): ConstructContract =>
  UNO_PARITY_ROWS.includes(row.id) && row.levels?.L2e.status === 'PASS'
    ? { ...row, levels: { ...row.levels, L2e: { status: 'PASS', evidence: [...row.levels.L2e.evidence, 'EMU-16'] } } }
    : row;

// --- The contract -----------------------------------------------------------------------------

export const unoContract: UnoContract = {
  contractId: 'uno-arduino-avr',
  version: '0.1.6',
  status: 'v0 (R0.3): every open row is established; L1 waits for R1/R2, L3 for M06.',
  snapshot: {
    pinnedOn: day,
    fqbn: 'arduino:avr:uno',
    arduinoCli: '1.5.1',
    core: { ...core, published: '2026-05-21' },
    toolchain: 'avr-gcc 7.3.0-atmel3.6.1-arduino7',
    compilerFlags: '-Os -flto -std=gnu++11 -fpermissive -fno-exceptions -ffunction-sections -fdata-sections -fno-threadsafe-statics',
    libraries: [{ ...servoLibrary, published: '2025-11-06' }],
    emulator: { name: 'avr8js', version: '0.21.1', license: 'MIT', published: '2026-08-31' },
    mcuAssumed: 'atmega328p',
    boardIdentity: 'UNKNOWN',
    statement:
      'The exact board (MCU, USB-serial chip, bootloader) is UNKNOWN; this contract is pinned to arduino-cli 1.5.1, arduino:avr@1.8.8, Servo 1.3.0 and avr8js 0.21.1 for an ATmega328P at 16 MHz as of 2026-10-25, and is not a timeless compatibility guarantee.',
  },
  rv1: 'ACCEPT_WITH_RESTRICTIONS',
  evidence,
  board: {
    mcu: 'atmega328p',
    clockHz: 16_000_000,
    adcMax: 1023,
    pwmMax: 255,
    flashBytes: 32_256,
    ramBytes: 2048,
    pwmPins: [
      { pin: 'D3', timer: 'T2', mode: 'phase-correct', frequencyHz: 490.196 },
      { pin: 'D5', timer: 'T0', mode: 'fast', frequencyHz: 976.5625 },
      { pin: 'D6', timer: 'T0', mode: 'fast', frequencyHz: 976.5625 },
      { pin: 'D9', timer: 'T1', mode: 'phase-correct', frequencyHz: 490.196 },
      { pin: 'D10', timer: 'T1', mode: 'phase-correct', frequencyHz: 490.196 },
      { pin: 'D11', timer: 'T2', mode: 'phase-correct', frequencyHz: 490.196 },
    ],
    reserved: [
      { pin: 'D0', when: 'serial' },
      { pin: 'D1', when: 'serial' },
    ],
    timerClaims: { servo: 'T1', tone: 'T2' },
    nonPwmThreshold: 128,
  },
  numeric: {
    model: 'cxx-int32',
    min: -2_147_483_648,
    max: 2_147_483_647,
    overflow: 'wrap',
    division: 'truncate-toward-zero',
    remainder: 'sign-of-dividend',
    int32MinDividedByMinusOne: -2_147_483_648,
    remainderByMinusOne: 0,
    divisionByZero: { quotient: 0, remainder: 0, warning: 'division-by-zero' },
    boolPrints: { true: '1', false: '0' },
    literalSuffix: 'L',
    int32MinLiteral: '(-2147483647L - 1L)',
    float: 'excluded',
  },
  constants: {
    LOOP_MIN_US: 50,
    NODE_US: 1,
    SERIAL_BAUD: 9600,
    SERIAL_FRAME_US: 1040,
    SERIAL_TX_QUEUE_BYTES: 64,
    PULSEIN_TIMEOUT_US: 30_000,
    ULTRASONIC_US_PER_CM: 58,
    ULTRASONIC_MIN_CM: 2,
    ULTRASONIC_MAX_CM: 400,
    ULTRASONIC_NO_ECHO_CM: 400,
    MAX_WAIT_MS: 60_000,
    COUNT_UP_MAX_END: 2_147_483_646,
    MOTOR_SPEED_MAX: 100,
    SERVO_ANGLE_MAX: 180,
    SERVO_START_ANGLE: 90,
    TONE_MIN_HZ: 31,
    TONE_MAX_HZ: 4000,
    TONE_MIN_MS: 1,
    TONE_MAX_MS: 60_000,
    PWM_MAX: 255,
    RAM_SOLUTION_MAX_PERCENT: 75,
    RAM_WARN_ABOVE_BYTES: 1536,
  },
  costsUs: {
    pinMode: 4.375,
    pinModeInputPullup: 4.75,
    digitalWrite: 4.5625,
    digitalWriteTimerPin: 5.625,
    digitalRead: 3.9375,
    digitalReadTimerPin: 5.0625,
    analogRead: 105.8125,
    analogReadFirst: 201.8125,
    analogWrite: 7.6875,
    analogWriteDigital: 11.875,
    millis: 1.1875,
    delayOverhead: 8.5625,
    servoWrite: 49.5,
    tone: 174.0625,
    noTone: 6.375,
    pulseInAfterPulse: 3.25,
    pulseInNoPulse30000: 20_752,
    ultrasonicCmOverhead: 65.5625,
    ultrasonicCmNoEcho: 20_812,
    motorSetOverhead: 43.3125,
    serialWriteByte: 4.625,
    serialQueueByte: 6.28125,
    serialLineByte: 1040,
    serialPrintLongBase: 9.375,
    serialPrintLongDigit: 45.1875,
    serialPrintLongSign: 6.8125,
    serialPrintln: 17.25,
  },
  costsEvidence: ['EMU-08', 'EMU-03', 'EMU-13', 'EMU-17', 'EMU-18'],
  toneUs: {
    // Tone.cpp takes prescaler p once floor(8e6 / (p · f)) ≤ 256: a band starts at floor(16e6 / (514 · p)) + 1 Hz. Measured on the
    // sketch the generator writes, the frequency computed at run time, the longest of the band's frequencies (EMU-18).
    bands: [
      { prescaler: 1024, fromHz: 31, silentUs: 306.5625, playingUs: 300.5625 },
      { prescaler: 256, fromHz: 122, silentUs: 298.1875, playingUs: 293.4375 },
      { prescaler: 128, fromHz: 244, silentUs: 258.9375, playingUs: 254.0 },
      { prescaler: 64, fromHz: 487, silentUs: 219.6875, playingUs: 214.625 },
      { prescaler: 32, fromHz: 973, silentUs: 181.5625, playingUs: 176.5625 },
      { prescaler: 8, fromHz: 3892, silentUs: 143.3125, playingUs: 138.5 },
    ],
    evidence: ['EMU-18'],
  },
  isrLoad: { timer0: 0.00583, perServo: 0.00163, tonePerHz: 0.0000149, charged: false },
  millis: { overflowUs: 1024, fractPerOverflow: 3, fractMax: 125, evidence: ['EMU-12', 'EMU-13'] },
  helpers: Object.fromEntries(Object.entries(helpers).map(([id, helper]) => [id, { text: helper.text, usedBy: [...helper.usedBy] }])),
  diagnostics: [
    { id: 'value-out-of-range', severity: 'error', when: 'A literal outside its domain (int32 literal, wait 0..60000, count up end <= 2147483646).' },
    { id: 'descending-range-not-supported', severity: 'error', when: 'A count up with a literal start greater than a literal end.' },
    { id: 'out-of-domain', severity: 'error', when: 'A computed value outside its domain at run time: the simulator stops (refusal to simulate, not semantics).' },
    { id: 'timer-claimed', severity: 'error', when: 'PWM on a pin whose timer the kit\'s servo (T1) or buzzer (T2) holds (U-48).' },
    { id: 'pin-unavailable', severity: 'error', when: 'A raw pin the kit uses, a floating pin read, or D0/D1 while the program prints.' },
    { id: 'capability-unavailable', severity: 'error', when: 'A block names a role the kit does not have.' },
    { id: 'value-clamped', severity: 'warning', when: 'A motor speed, servo angle, tone or PWM value outside its range, clamped; once per role (pin) per run.' },
    { id: 'not-pwm', severity: 'warning', when: 'PWM write on a pin without PWM: 128 and above HIGH, below LOW.' },
    { id: 'division-by-zero', severity: 'warning', when: 'A division or remainder by 0 gave 0; once per block per run.' },
    { id: 'low-memory', severity: 'warning', when: 'L2: global variables above 1536 bytes (75 % of 2 KB), as arduino-cli warns.' },
  ],
  modules,
  constructs: [...exposedRows.map(withParity), ...closedRows],
};
