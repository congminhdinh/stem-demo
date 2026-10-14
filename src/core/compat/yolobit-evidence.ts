import type { EvidenceEntry, EvidenceKind, EvidenceRef, LedgerSupport, OfField } from './contract-types';

// The evidence ledger of the Yolo:Bit contract (docs/yolobit-compatibility-contract.md §20),
// as data. Every date is the observation or access day of the pinned snapshot.
// The evidence itself lives outside the repo; this is only the index, with the
// claim kinds each entry may support (RV-1, "Claim được đỡ").
//
// One deviation from the document's table, forced by the machine-readable
// shape: EVD-02 is "GEN + UI" there and an entry here has a single kind, so it
// is split into EVD-02 (GEN, the generated call shapes) and EVD-02U (UI, the
// tooltip and label text of the same toolbox).

const day = '2026-10-14';

const entry = (
  kind: EvidenceKind,
  source: string,
  action: string,
  observed: string,
  supports: readonly LedgerSupport[],
  establishes: readonly OfField[] = [],
): EvidenceEntry => ({ kind, date: day, source, action, observed, supports, establishes });

const editor = 'app.ohstem.vn/#!/codes/yolobit ?v=20261007130057';
const simulator = 'Project Builder → Stem Kit Shield, build 658a5…';

const ledger: Record<EvidenceRef, EvidenceEntry> = {
  'EVD-01': entry('GEN', editor, 'Read the asset marker, Blockly.VERSION and the default block', '?v=20261007130057; Blockly 8.0.1', ['snapshot']),
  'EVD-02': entry('GEN', editor, 'Read the toolbox: fields and dropdowns', 'Pin dropdowns; the call each block generates', ['call-shape']),
  'EVD-02U': entry('UI', editor, 'Read the toolbox: tooltips and labels', 'Unit, range and reset wording as the editor states it', ['ui-statement']),
  'EVD-03': entry('GEN', editor, 'Built 179 minimal programs of our own and read the Python', 'Call shapes, imports and the preamble', ['call-shape', 'import-syntax', 'preamble-text']),
  'EVD-04': entry('GEN', editor, 'Compared the toggle text with the programmatic read', 'Identical', ['method']),
  'EVD-05': entry('GEN', editor, 'Image block, each cell, each colour', 'Image("r0:…:r4"); the digit is the colour-table index', ['encoding']),
  'EVD-06': entry('SIM', simulator, 'Timestamp marks around sleep, show, pitch, scroll, clear, set_pixel and clear_pixel (program s13, M0–M13)', 'show ≈5 ms; pitch ≈1 ms; "HI" 2398 ms; (0,0) top-left; (3,1) is row 1 column 3', ['blocking', 'display-transition', 'sim-module']),
  'EVD-07': entry('SIM', simulator, 'Scrolled "ABC", "HELLO", "A B", "ab"', '3596 / 6001 / 3602 / 2405 ms; one column per ≈200 ms; six columns per character', ['blocking', 'display-transition']),
  'EVD-08': entry('SIM', simulator, 'Tempo, notes, rests, reset, get_tempo, pitch and stop, melodies', '(4,120) ":4" ≈500 ms; default (4,60); "440:4" does not play; DB4 277 Hz', ['blocking', 'sound-indicator', 'return-reset', 'sim-module']),
  'EVD-09': entry('SIM', simulator, 'Held A/B while polling; three clicks in a sleep; click then is_pressed', 'True only while held; 3 then 0; False after release', ['return-reset']),
  'EVD-10': entry('SIM', simulator, 'Printed light_level(), temperature() and the accelerometer', 'Light is an int; temperature a float with one digit; the widget shows 0–100', ['return-reset']),
  'EVD-11': entry('SIM', simulator, 'running_time() twice; the numbers -7, 0, 100; the text "à"', 'Epoch-like values; 2400 / ~0 / 3602 ms; KeyError / empty cell', ['blocking', 'display-transition', 'return-reset']),
  'EVD-12': entry('SIM', simulator, 'Every character 0x21–0x7E', '94 of 94 shown, no error', ['display-transition']),
  'EVD-13': entry('SIM', simulator, 'Multi-colour images, brightness, colour #123456, set_all, out-of-range coordinates', 'Digits 2 → yellow, 6/7 → magenta; brightness unchanged; out-of-range ignored', ['display-transition']),
  'EVD-14': entry('SIM', simulator, 'Part "Rotary Analog" on port A; Home/End of the widget', 'The widget spans 0–4095; P0 reads 0 / 4095; noisy floats', []),
  'EVD-15': entry('SIM', simulator, 'Part "single LED"; write_analog 0…4095', 'On/off alike for every non-zero value', []),
  'EVD-16': entry('SIM', simulator, 'Program s26 (K0–K5): servo_write(P0, 90 then 0); read_digital(P1); write_digital(P2, 1) then read_digital(P2); pulse_in(P1); is_pressed(A); a print between each', 'servo_write ≈0.4–0.7 ms; read_digital printed 0 at +2.4 ms; write_digital + read_digital printed 1 at +0.24 ms; is_pressed printed False at +3.8 ms; pulse_in returns 0 at once; read_digital returns an int 0/1', ['blocking', 'return-reset']),
  'EVD-17': entry('SIM', simulator, 'Overwrote frames; scroll(""); get_presses while held', 'Image and scroll replace the whole frame; "" changes nothing; 1 then 0', ['display-transition', 'return-reset']),
  'EVD-18': entry('WEB', 'fw.ohstem.vn', 'Read the firmware dropdown', '"Yolo:Bit S3 v1.14", "Yolo:Bit v1.12"', ['snapshot']),
  'EVD-19': entry('SIM', simulator, 'button_a.is_pressed_ab()', 'AttributeError', ['return-reset']),
  'EVD-20': entry('SIM', simulator, 'Notes with :1 :2 :4 :8; rests :2 :8', '131 / 250 / 500 / 500 ms; 249 / 500 ms', ['sound-indicator', 'blocking']),
  'EVD-21': entry('SIM', simulator, '15 notes C3…C5', 'The Hz table of contract §8.1', ['sound-indicator']),
  'EVD-22': entry('GEN', editor, 'Programs P1–P11, first revision', 'Contract §18.1', ['parity-output']),
  'EVD-23': entry('GEN', editor, 'P10 second revision and count up with a get_presses bound', 'i_end = float(button_a.get_presses())', ['parity-output', 'call-shape']),
  'EVD-24': entry('SIM', simulator, 'Program s15 E: poll button_a.is_pressed() and button_b.is_pressed() in a loop with a print, while A then B are held', 'ESTART marker, then the first poll line after 8.1 ms (two is_pressed calls and a print); polling continued while a button was held, the line changing to "True False" and "False True"', ['blocking']),
  'EVD-25': entry('SIM', simulator, 'Program s14 C2: print(button_a.get_presses()) twice in a row after three clicks', 'Prints 3, then prints 0 about 0.9 ms later: the second call returned promptly', ['blocking']),
  'EVD-26': entry('SIM', simulator, 'Program s14 D: marker "D0", then print(light_level()), print(temperature())', 'light_level() printed 80 at +3.6 ms after the marker, temperature() printed 28.0 at +6.8 ms: both calls returned promptly', ['blocking']),
  'EVD-27': entry('SIM', simulator, 'Program s23: one print of read_analog() on 11 pins (P0–P7, P10–P12) in a loop with sleep(400)', 'The first line printed 41 ms after the ASTART marker (11 reads, a join and a print); the loop period was ≈460 ms for a 400 ms sleep: read_analog does not wait', ['blocking']),
  'EVD-28': entry('SIM', simulator, 'Program s16 I: set_all(#0000ff), then sleep(500), marked I6 and I7', 'I6 to I7 took 499.7 ms for a 500 ms sleep: set_all added no measurable wait', ['blocking']),
  'DOC-W1': entry('WEB', 'https://ohstem.vn/product/may-tinh-lap-trinh-yolobit/', 'Read the product page', '"25 đèn LED đa màu, được sắp xếp theo ma trận vuông 5 x 5."', ['documented']),
  'DOC-W2': entry('WEB', 'https://ohstem.vn/gioi-thieu-ve-do-choi-tri-tue-yolobit/', 'Read the page', 'ESP32 (160–240 MHz); pins P0 to P20; P0, P1, P2 are multi-function (digital and analog)', ['documented']),
  'DOC-W3': entry('WEB', 'https://ohstem.vn/so-sanh-microbit-va-yolobit/', 'Read the page', '5×5 multi-colour LEDs; dual-core 32-bit Xtensa LX6; pins P0, P1, P2, GND and 3V', ['documented']),
  'DOC-W4': entry('WEB', 'https://ohstem.vn/bat-led-ngau-nhien-he-toa-do-xy/', 'Read the page', 'The first column is column 0, then 1, 2, 3, 4; likewise rows 0 to 4', ['documented']),
  'DOC-W5': entry('WEB', 'https://ohstem.vn/yolobit-la-gi-cong-cu-hoc-lap-trinh/', 'Read the page', 'The Yolo:Bit is programmed with blocks and with MicroPython', ['documented']),
  'DOC-W6': entry('WEB', 'https://docs.ohstem.vn/en/latest/module/cam-bien/goc-xoay.html', 'Read the rotary-angle sensor page', 'Analog signal (0~4095); connects to P0, P1, P2; 0–4095 becomes 0–100 %', ['documented']),
  'DOC-W7': entry('WEB', 'https://docs.ohstem.vn/en/latest/module/cam-bien/rotary.html', 'Read the rotary sensor page', 'Analog value from 0 to 4095 for the Yolo:Bit', ['documented']),
  'DOC-M1': entry('MPY', 'https://docs.micropython.org/en/latest/library/time.html', 'Read time.sleep_ms', '"…delay for at least the given number of milliseconds…"; positive or 0', ['documented']),
  'DOC-M2': entry('MPY', 'https://docs.micropython.org/en/latest/library/random.html', 'Read random', 'randint() and choice() exist only if MICROPY_PY_RANDOM_EXTRA_FUNCS is enabled', ['documented']),
  'DOC-M3': entry('MPY', 'https://docs.micropython.org/en/latest/library/random.html and genrst/modules.html', 'Read randint and getrandbits', 'randint returns an integer in [a, b], at most the native word size', ['documented']),
  'DOC-M4': entry('MPY', 'https://docs.micropython.org/en/latest/library/time.html', 'Read ticks_ms', 'Arbitrary reference point that wraps around (does not apply to running_time)', ['documented']),
  'DOC-M5': entry('MPY', 'https://docs.micropython.org/en/latest/esp32/quickref.html', 'Read ADC.read', '0–4095 for 12-bit resolution (generic ESP32, not the Yolo:Bit wrapper)', ['context']),
  'DOC-M6': entry('MPY', 'https://docs.micropython.org/en/latest/esp32/quickref.html', 'Read pins and PWM', 'Pins 34–39 are input only; PWM duty() 0–1023 (generic machine.PWM)', ['context']),
  'DOC-M7': entry('MPY', 'https://docs.micropython.org/en/latest/library/machine.html', 'Read time_pulse_us', 'Returns -2 / -1 on timeouts', ['context']),
  'DOC-M8': entry('MPY', 'https://docs.micropython.org/en/latest/genrst/index.html', 'Read the language summary', 'Python 3.4 and some select features of Python 3.5 and above', ['documented']),
  'DOC-M9': entry('MPY', 'https://docs.micropython.org/en/latest/genrst/builtin_types.html', 'Read the range difference', 'Range arguments must fit in a machine word; large values misbehave', ['documented']),
  'DOC-M10': entry('MPY', 'https://docs.micropython.org/en/latest/esp32/quickref.html', 'Read delay and timing', 'Use the time module: import time; time.sleep_ms(500)', ['documented']),
};

/**
 * The observable fields each entry can establish: the call or trace it records
 * (contract §20, "Contract ID"). An entry listed here for no field, such as the
 * context-only ones (EVD-14, EVD-15, DOC-M5…M7), establishes nothing.
 * EVD-24…EVD-28 are traces already captured in YB-0 (programs s15 E, s14 C2/D,
 * s23, s16 I) that §20 did not list as `blocking` evidence; they were added
 * when the exposure gate began to check which entry may establish which field.
 */
const establishes: Readonly<Record<EvidenceRef, readonly OfField[]>> = {
  'EVD-02': ['call', 'range'],
  'EVD-02U': ['unit', 'range', 'block', 'return', 'content'],
  'EVD-03': ['call', 'import', 'content'],
  'EVD-05': ['range', 'content'],
  'EVD-06': ['module', 'block'],
  'EVD-07': ['unit', 'block', 'coord', 'content'],
  'EVD-08': ['module'],
  'EVD-09': ['return'],
  'EVD-10': ['round'],
  'EVD-12': ['range'],
  'EVD-16': ['block'],
  'EVD-17': ['return', 'content'],
  'EVD-20': ['unit', 'range', 'block'],
  'EVD-21': ['range', 'content'],
  'EVD-24': ['block'],
  'EVD-25': ['block'],
  'EVD-26': ['block'],
  'EVD-27': ['block'],
  'EVD-28': ['block'],
  'DOC-W2': ['range'],
  'DOC-W4': ['range', 'coord'],
  'DOC-W5': ['module'],
  'DOC-W6': ['range', 'return'],
  'DOC-W7': ['range', 'return'],
  'DOC-M1': ['unit', 'range', 'block'],
  'DOC-M3': ['range'],
  'DOC-M8': ['call', 'module', 'range', 'round', 'return', 'error', 'content', 'block'],
  'DOC-M9': ['range'],
  'DOC-M10': ['module'],
};

export const evidenceLedger: Readonly<Record<EvidenceRef, EvidenceEntry>> = Object.fromEntries(
  Object.entries(ledger).map(([id, entry]) => [id, { ...entry, establishes: establishes[id] ?? [] }]),
);
